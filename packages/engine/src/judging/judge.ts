import { formatTranscript, motionData, SAME_LANGUAGE, UNTRUSTED_NOTICE } from '../debate/prompts';
import { MAX_ATTEMPTS, nextSlot } from '../debate/schedule';
import type { DebateSetup, ModelId, Rubric, RubricScore, Side, Turn, Verdict } from '../domain';
import { DebateNotFinishedError, VerdictParseError } from '../errors';
import type { ModelClient, ModelMessage } from '../models/client';
import { dominantScript } from '../turns/script';
import { validatePanel } from './panel';

export const JUDGE_OUTPUT_TOKENS = 1000;

export function buildJudgeMessages(setup: DebateSetup, turns: Turn[]): ModelMessage[] {
  const rubric = setup.format.rubric.criteria.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const system = [
    'You are the Judge of a structured debate. Decide which Side argued better.',
    `Score the debate against this Rubric:\n${rubric}`,
    'You must choose one Side, For or Against. A draw is not allowed.',
    'Give each Side a whole number from 1 to 10 on every criterion. Your winner is your overall judgement.',
    `Reply with JSON only, in this shape: {"scores": {${setup.format.rubric.criteria.map(c => `"${c.name}": {"for": <1-10>, "against": <1-10>}`).join(', ')}}, "winner": "for" | "against", "reasoning": "<a few sentences>"}`,
    `Write the reasoning in the ${SAME_LANGUAGE}, even if the Turns use another.`,
    UNTRUSTED_NOTICE,
  ].join('\n\n');
  const user = `Motion: ${motionData(setup.motion)}\n\nTurns:\n${formatTranscript(setup.format, turns)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

type ParsedVerdict = { winner: Side; reasoning: string; scores: RubricScore[] | null };

const isMark = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10;

/**
 * One Rubric Score per criterion, in Rubric order, or null if any is missing or not a whole number from 1 to 10.
 * Criterion names come from the Rubric, never from the reply: extra keys in the reply are ignored.
 */
function parseScores(value: unknown, rubric: Rubric): RubricScore[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const scores: RubricScore[] = [];
  for (const { name } of rubric.criteria) {
    const entry: unknown = Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;
    if (typeof entry !== 'object' || entry === null) return null;
    const { for: f, against: a } = entry as Record<string, unknown>;
    if (!isMark(f) || !isMark(a)) return null;
    scores.push({ criterion: name, for: f, against: a });
  }
  return scores;
}

/** The winner and reasoning, or null if unusable. `scores` is null when they are fine but the Rubric Scores are not. */
export function parseVerdict(text: string, rubric: Rubric): ParsedVerdict | null {
  // The closing fence is cut without a regex: `\s*```$` backtracks quadratically over a long run of whitespace.
  let body = text.trim().replace(/^```(?:json)?\s*/i, '');
  if (body.endsWith('```')) body = body.slice(0, -3).trimEnd();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { winner, reasoning, scores } = value as Record<string, unknown>;
  if ((winner !== 'for' && winner !== 'against') || typeof reasoning !== 'string' || !reasoning.trim()) return null;
  return { winner, reasoning, scores: parseScores(scores, rubric) };
}

/**
 * The follow-up to a Verdict in the wrong language. Asking the same question again tends to get the same answer
 * (a Judge answered an English Motion in Chinese twice), so the Judge sees its reply and is asked to rewrite it.
 */
export function rewriteRequest(setup: DebateSetup): string {
  return [
    `Your reasoning is not in the language of the Motion. The Motion is: ${motionData(setup.motion)}`,
    `Rewrite the reasoning in the ${SAME_LANGUAGE}. Keep your winner. Reply with the same JSON only.`,
  ].join('\n\n');
}

/** The follow-up to a Verdict whose Rubric Scores are missing or invalid. */
export const SCORES_REQUEST =
  'Your scores are missing or invalid. Give each Side a whole number from 1 to 10 on every criterion of the Rubric. Keep your winner. Reply with the same JSON only.';

async function askJudge(setup: DebateSetup, turns: Turn[], judge: ModelId, client: ModelClient): Promise<Omit<Verdict, 'judges'>> {
  const question = buildJudgeMessages(setup, turns);
  let messages = question;
  const motionScript = dominantScript(setup.motion.text);
  // The latest usable Verdict with a flaw (wrong language or bad Rubric Scores), kept in case no attempt is flawless.
  let flawed: ParsedVerdict | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.complete({ model: judge, messages, maxOutputTokens: JUDGE_OUTPUT_TOKENS });
    const verdict = parseVerdict(response.text, setup.format.rubric);
    if (!verdict) continue;
    // Reasoning in another script than the Motion is in another language: ask for it rewritten.
    const script = dominantScript(verdict.reasoning);
    const rightLanguage = motionScript === null || script === null || script === motionScript;
    if (rightLanguage && verdict.scores) return { ...verdict, scores: verdict.scores };
    flawed = verdict;
    const followUp = rightLanguage ? SCORES_REQUEST : rewriteRequest(setup);
    messages = [...question, { role: 'assistant', content: response.text }, { role: 'user', content: followUp }];
  }
  // A Verdict in the wrong language, or without Rubric Scores, beats failing a finished Debate.
  if (flawed) return { ...flawed, scores: flawed.scores ?? [] };
  throw new VerdictParseError(`${judge} did not return a valid Verdict`);
}

/** Asks the Panel for a Verdict on a finished Debate. Panels hold one Judge in this release. */
export async function judgeDebate(setup: DebateSetup, turns: Turn[], client: ModelClient): Promise<Verdict> {
  if (nextSlot(setup.format, turns)) throw new DebateNotFinishedError('The Debate still has Turns to come');
  validatePanel(setup.panel);
  const judge = setup.panel[0]!;
  const { winner, reasoning, scores } = await askJudge(setup, turns, judge, client);
  return { winner, reasoning, scores, judges: [...setup.panel] };
}
