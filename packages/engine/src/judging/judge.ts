import { formatTranscript, motionData, SAME_LANGUAGE, UNTRUSTED_NOTICE } from '../debate/prompts';
import { MAX_ATTEMPTS, nextSlot } from '../debate/schedule';
import type { Ballot, ClaimCheck, Confidence, DebateSetup, ModelId, Rubric, RubricScore, Side, Turn, Verdict } from '../domain';
import { DebateNotFinishedError, VerdictParseError } from '../errors';
import type { ModelClient, ModelMessage } from '../models/client';
import { dominantScript } from '../turns/script';
import { validatePanel } from './panel';

export const JUDGE_OUTPUT_TOKENS = 1600;
/** The most Claim Checks kept from one Ballot, and the longest claim, note or crux kept: model output is untrusted. */
export const MAX_CLAIMS = 6;
export const MAX_CLAIM_CHARS = 300;

export function buildJudgeMessages(setup: DebateSetup, turns: Turn[]): ModelMessage[] {
  const rubric = setup.format.rubric.criteria.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const criteria = setup.format.rubric.criteria.map(c => `"${c.name}": {"for": <1-10>, "against": <1-10>}`).join(', ');
  const system = [
    'You are a Judge of a structured debate. Decide whether the Motion stands: For means it stands, Against that it falls.',
    'Decide on the arguments and evidence in this Debate, not your own view of the Motion. Weigh which claims held up, which were answered, and what was left standing. Use your own knowledge only to check factual claims.',
    'You must choose one Side, For or Against. A draw is not allowed. Say how sure you are: "clear", "likely", or "narrow" when it is too close to call.',
    `Separately, score how well each Side argued against this Rubric:\n${rubric}`,
    'Give each Side a whole number from 1 to 10 on every criterion. The scores rate the debating and may favour the Side that loses; if they do, your reasoning names the point that decides the Motion.',
    `Name the crux: the one question the disagreement comes down to. Check up to ${MAX_CLAIMS} of the most important factual claims either Side made: "supported", "disputed" (contested or unsure) or "false", each with a short note. Judge a false claim's argument as not established.`,
    `Reply with JSON only, in this shape: {"scores": {${criteria}}, "claims": [{"side": "for" | "against", "claim": "<the claim>", "status": "supported" | "disputed" | "false", "note": "<why>"}], "crux": "<one sentence>", "winner": "for" | "against", "confidence": "clear" | "likely" | "narrow", "reasoning": "<a few sentences>"}`,
    `Write the reasoning, crux and notes in the ${SAME_LANGUAGE}, even if the Turns use another.`,
    UNTRUSTED_NOTICE,
  ].join('\n\n');
  const user = `Motion: ${motionData(setup.motion)}\n\nTurns:\n${formatTranscript(setup.format, turns)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

type ParsedVerdict = Omit<Ballot, 'judge' | 'scores'> & { scores: RubricScore[] | null };

const CONFIDENCES: readonly string[] = ['clear', 'likely', 'narrow'] satisfies Confidence[];
const STATUSES: readonly string[] = ['supported', 'disputed', 'false'];
const cut = (text: string) => text.trim().slice(0, MAX_CLAIM_CHARS);

/** The valid Claim Checks, at most MAX_CLAIMS; anything malformed is dropped, not fatal. */
function parseClaims(value: unknown): ClaimCheck[] {
  if (!Array.isArray(value)) return [];
  const claims: ClaimCheck[] = [];
  for (const item of value) {
    if (claims.length === MAX_CLAIMS) break;
    if (typeof item !== 'object' || item === null) continue;
    const { side, claim, status, note } = item as Record<string, unknown>;
    if ((side !== 'for' && side !== 'against') || typeof status !== 'string' || !STATUSES.includes(status)) continue;
    if (typeof claim !== 'string' || !claim.trim() || typeof note !== 'string') continue;
    claims.push({ side, claim: cut(claim), status: status as ClaimCheck['status'], note: cut(note) });
  }
  return claims;
}

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

/**
 * The winner and reasoning, or null if unusable. `scores` is null when they are fine but the Rubric Scores are not.
 * A bad confidence reads as `narrow`, a bad crux as '', bad claims are dropped: they never fail a finished Debate.
 */
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
  const { winner, reasoning, scores, confidence, crux, claims } = value as Record<string, unknown>;
  if ((winner !== 'for' && winner !== 'against') || typeof reasoning !== 'string' || !reasoning.trim()) return null;
  return {
    winner,
    reasoning,
    scores: parseScores(scores, rubric),
    confidence: typeof confidence === 'string' && CONFIDENCES.includes(confidence) ? (confidence as Confidence) : 'narrow',
    crux: typeof crux === 'string' ? cut(crux) : '',
    claims: parseClaims(claims),
  };
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

export async function askJudge(setup: DebateSetup, turns: Turn[], judge: ModelId, client: ModelClient): Promise<Ballot> {
  const question = buildJudgeMessages(setup, turns);
  let messages = question;
  const motionScript = dominantScript(setup.motion.text);
  // The best usable Verdict with a flaw, kept in case no attempt is flawless. Viewers read the reasoning, so one in
  // the Motion's language ranks above one with Rubric Scores; on a tie, the later reply wins.
  let flawed: ParsedVerdict | null = null;
  let flawedRank = -1;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.complete({ model: judge, messages, maxOutputTokens: JUDGE_OUTPUT_TOKENS });
    const verdict = parseVerdict(response.text, setup.format.rubric);
    if (!verdict) continue;
    // Reasoning in another script than the Motion is in another language: ask for it rewritten.
    const script = dominantScript(verdict.reasoning);
    const rightLanguage = motionScript === null || script === null || script === motionScript;
    if (rightLanguage && verdict.scores) return { judge, ...verdict, scores: verdict.scores };
    const rank = (rightLanguage ? 2 : 0) + (verdict.scores ? 1 : 0);
    if (rank >= flawedRank) [flawed, flawedRank] = [verdict, rank];
    const followUp = [rightLanguage ? '' : rewriteRequest(setup), verdict.scores ? '' : SCORES_REQUEST].filter(Boolean).join('\n\n');
    messages = [...question, { role: 'assistant', content: response.text }, { role: 'user', content: followUp }];
  }
  // A Verdict in the wrong language, or without Rubric Scores, beats failing a finished Debate.
  if (flawed) return { judge, ...flawed, scores: flawed.scores ?? [] };
  throw new VerdictParseError(`${judge} did not return a valid Verdict`);
}

const CONFIDENCE_RANK: Record<Confidence, number> = { clear: 2, likely: 1, narrow: 0 };

/**
 * The Panel's Ballots decide by majority. A 1–1 split (a third Judge failed) goes to the more confident Ballot, then
 * to Panel order. The lead Ballot, whose reasoning, scores, crux and claims the Verdict shows, is the first on the
 * winning Side.
 */
function leadBallot(ballots: Ballot[]): Ballot {
  const votes = { for: 0, against: 0 };
  for (const b of ballots) votes[b.winner]++;
  if (votes.for !== votes.against) {
    const winner: Side = votes.for > votes.against ? 'for' : 'against';
    return ballots.find(b => b.winner === winner)!;
  }
  return ballots.reduce((best, b) => (CONFIDENCE_RANK[b.confidence] > CONFIDENCE_RANK[best.confidence] ? b : best));
}

/** A split Panel is never more than likely; a 1–1 split (a third Judge failed) is too close to call. */
function panelConfidence(lead: Ballot, ballots: Ballot[]): Confidence {
  const agree = ballots.filter(b => b.winner === lead.winner).length;
  if (agree === ballots.length) return lead.confidence;
  if (agree * 2 === ballots.length) return 'narrow';
  return lead.confidence === 'clear' ? 'likely' : lead.confidence;
}

/**
 * Asks every Judge on the Panel for a Ballot, in parallel, on a finished Debate. A Judge that fails is left out
 * rather than failing the Debate, and `judges` names only those whose Ballots count; only when every Judge fails
 * does judging fail. Errors `rethrow` marks (a batch result not ready yet, an exhausted Budget) are not Judge
 * failures: every Judge has been asked by then, so the host can wait and judge again.
 */
export async function judgeDebate(
  setup: DebateSetup,
  turns: Turn[],
  client: ModelClient,
  options: { rethrow?: (error: unknown) => boolean } = {},
): Promise<Verdict> {
  if (nextSlot(setup.format, turns)) throw new DebateNotFinishedError('The Debate still has Turns to come');
  validatePanel(setup.panel);
  const settled = await Promise.allSettled(setup.panel.map(judge => askJudge(setup, turns, judge, client)));
  const marked = settled.find(r => r.status === 'rejected' && options.rethrow?.(r.reason));
  if (marked?.status === 'rejected') throw marked.reason;
  const ballots = settled.flatMap(s => (s.status === 'fulfilled' ? [s.value] : []));
  if (ballots.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const leader = leadBallot(ballots);
  const { judge: _, ...lead } = leader;
  return { ...lead, confidence: panelConfidence(leader, ballots), judges: ballots.map(b => b.judge), ballots };
}
