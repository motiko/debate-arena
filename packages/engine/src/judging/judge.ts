import { formatTranscript, motionData, SAME_LANGUAGE, UNTRUSTED_NOTICE } from '../debate/prompts';
import { MAX_ATTEMPTS, nextSlot } from '../debate/schedule';
import type { DebateSetup, ModelId, Side, Turn, Verdict } from '../domain';
import { DebateNotFinishedError, VerdictParseError } from '../errors';
import type { ModelClient, ModelMessage } from '../models/client';
import { dominantScript } from '../turns/script';
import { validatePanel } from './panel';

export const JUDGE_OUTPUT_TOKENS = 800;

export function buildJudgeMessages(setup: DebateSetup, turns: Turn[]): ModelMessage[] {
  const rubric = setup.format.rubric.criteria.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const system = [
    'You are the Judge of a structured debate. Decide which Side argued better.',
    `Score the debate against this Rubric:\n${rubric}`,
    'You must choose one Side, For or Against. A draw is not allowed.',
    'Reply with JSON only, in this shape: {"winner": "for" | "against", "reasoning": "<a few sentences>"}',
    `Write the reasoning in the ${SAME_LANGUAGE}, even if the Turns use another.`,
    UNTRUSTED_NOTICE,
  ].join('\n\n');
  const user = `Motion: ${motionData(setup.motion)}\n\nTurns:\n${formatTranscript(setup.format, turns)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseVerdict(text: string): { winner: Side; reasoning: string } | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { winner, reasoning } = value as Record<string, unknown>;
  if ((winner !== 'for' && winner !== 'against') || typeof reasoning !== 'string' || !reasoning.trim()) return null;
  return { winner, reasoning };
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

async function askJudge(setup: DebateSetup, turns: Turn[], judge: ModelId, client: ModelClient) {
  const question = buildJudgeMessages(setup, turns);
  let messages = question;
  const motionScript = dominantScript(setup.motion.text);
  let wrongLanguage: { winner: Side; reasoning: string } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.complete({ model: judge, messages, maxOutputTokens: JUDGE_OUTPUT_TOKENS });
    const verdict = parseVerdict(response.text);
    if (!verdict) continue;
    // Reasoning in another script than the Motion is in another language: ask for it rewritten.
    const script = dominantScript(verdict.reasoning);
    if (motionScript === null || script === null || script === motionScript) return verdict;
    wrongLanguage = verdict;
    messages = [...question, { role: 'assistant', content: response.text }, { role: 'user', content: rewriteRequest(setup) }];
  }
  // A Verdict in the wrong language beats failing a finished Debate.
  if (wrongLanguage) return wrongLanguage;
  throw new VerdictParseError(`${judge} did not return a valid Verdict`);
}

/** Asks the Panel for a Verdict on a finished Debate. Panels hold one Judge in this release. */
export async function judgeDebate(setup: DebateSetup, turns: Turn[], client: ModelClient): Promise<Verdict> {
  if (nextSlot(setup.format, turns)) throw new DebateNotFinishedError('The Debate still has Turns to come');
  validatePanel(setup.panel);
  const judge = setup.panel[0]!;
  const { winner, reasoning } = await askJudge(setup, turns, judge, client);
  return { winner, reasoning, judges: [...setup.panel] };
}
