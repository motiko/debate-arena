// Pure view helpers for Debates, shared by pages and islands.
import type { DebateSummary } from '@debate-arena/api-client';
import { isSelfJudging, type Debater, type OxfordResult, type Phase, type Side, type Turn } from '@debate-arena/engine';
import { t } from '../i18n/t';

/** Matches the API's feed page size. */
export const FEED_PAGE_SIZE = 20;

export interface ModelInfo {
  id: string;
  label: string;
}

export function sideLabel(side: Side): string {
  return side === 'for' ? t('side.for') : t('side.against');
}

/** The `before` cursor for the next feed page, or null when this page is the last. */
export function nextFeedCursor(debates: Pick<DebateSummary, 'completedAt'>[], pageSize: number): string | null {
  if (debates.length < pageSize) return null;
  return debates.at(-1)?.completedAt ?? null;
}

/** Turn text as plain-text paragraphs (never HTML or Markdown): split on blank lines, empties dropped. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

type FormatPhases = { phases: Pick<Phase, 'name'>[] };

export function turnHeading(format: FormatPhases, turn: Pick<Turn, 'phaseIndex' | 'side'>): string {
  const phase = format.phases[turn.phaseIndex]?.name ?? `Phase ${turn.phaseIndex + 1}`;
  return `${phase} · ${sideLabel(turn.side)}`;
}

export interface PhaseGroup<T> {
  index: number;
  name: string;
  turns: T[];
}

/** Turns under their Phase, in Format order; Phases without Turns yet are left out. */
export function groupByPhase<T extends Pick<Turn, 'phaseIndex'>>(format: FormatPhases, turns: T[]): PhaseGroup<T>[] {
  return format.phases
    .map((phase, index) => ({ index, name: phase.name, turns: turns.filter(turn => turn.phaseIndex === index) }))
    .filter(group => group.turns.length > 0);
}

const signed = (points: number) => {
  const rounded = Math.round(points * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return '0';
};

/** The Audience Result in words: each Side's Swing in percentage points, and who wins the audience. */
export function swingText(result: OxfordResult, voters: 'members' | 'aiVoters' = 'members'): string {
  if (result.counted === 0) return t(voters === 'members' ? 'result.none' : 'result.noneAi');
  const outcome = result.winner === 'tie' ? t('result.tied') : t('result.wins', { side: sideLabel(result.winner) });
  const one = result.counted === 1;
  const who = voters === 'members' ? (one ? 'result.member' : 'result.members') : one ? 'result.aiVoter' : 'result.aiVoters';
  return t('result.swing', {
    for: signed(result.swing.for),
    against: signed(result.swing.against),
    members: t(who, { count: result.counted }),
    outcome,
  });
}

export interface SlotTurn {
  slotIndex: number;
  turn: Turn;
}

/**
 * Live Turns merged into the known ones by slot (a Turn's slot is its index): known slots are kept, duplicates
 * ignored, and the list stops at the first missing slot so Turns never show out of order.
 */
export function mergeTurns(known: Turn[], incoming: SlotTurn[]): Turn[] {
  const slots = new Map<number, Turn>(known.map((turn, i) => [i, turn]));
  for (const { slotIndex, turn } of incoming) if (!slots.has(slotIndex)) slots.set(slotIndex, turn);
  const merged: Turn[] = [];
  for (let i = 0; slots.has(i); i++) merged.push(slots.get(i)!);
  return merged;
}

/** Quota points a Debate costs (the API's DEBATE_QUOTA_POINTS); the API is the authority. */
export const DEBATE_QUOTA_POINTS = 2;
/** Quota points a Batch Debate costs (the API's BATCH_DEBATE_QUOTA_POINTS). */
export const BATCH_DEBATE_QUOTA_POINTS = 1;
/** The API's limit on a Motion's length. */
export const MAX_MOTION_LENGTH = 300;

/** Whether the chosen Judge would be Self-Judging: the same model as one of the Debaters. */
export function selfJudgingWarning(debaters: { for: string; against: string }, judge: string | null): boolean {
  if (!judge) return false;
  return isSelfJudging([judge], [
    { kind: 'ai', model: debaters.for },
    { kind: 'ai', model: debaters.against },
  ]);
}

export function modelLabel(id: string, models: ModelInfo[] = []): string {
  return models.find(m => m.id === id)?.label ?? id;
}

export function debaterLabel(debater: Debater, models: ModelInfo[]): string {
  return debater.kind === 'ai' ? modelLabel(debater.model, models) : debater.memberId;
}

export type MotionSize = 'l' | 'm' | 's';

/** The Motion's type size on the band: long Motions step down so the benches stay in view. */
export function motionSize(text: string): MotionSize {
  return text.length <= 120 ? 'l' : text.length <= 200 ? 'm' : 's';
}

export function spokeCount(turns: Pick<Turn, 'side'>[], side: Side): number {
  return turns.filter(turn => turn.side === side).length;
}

export type DispatchState = 'ask' | 'generating' | 'live' | 'judgingFailed' | 'failed' | 'revealed' | 'hidden';

interface DispatchInput {
  kind: 'live' | 'batch';
  status: 'running' | 'complete' | 'failed';
  turnsHidden: boolean;
  turns: unknown[];
  myVote: { before: unknown; after: unknown } | null;
  audienceResult: { votingClosesAt: string | null };
}

/**
 * What the dispatch box shows (spec: the dispatch box table, first match wins). The outcome is open only to a
 * reader of a live Debate with nothing left to vote on; everyone else asks for it ("Show the result").
 */
export function dispatchState(d: DispatchInput, now = Date.now()): DispatchState {
  if (d.turnsHidden) return 'ask';
  if (d.kind === 'batch' && d.status !== 'complete') return 'generating';
  if (d.status === 'running') return 'live';
  if (d.status === 'failed') return d.turns.length > 0 ? 'judgingFailed' : 'failed';
  const closesAt = d.audienceResult.votingClosesAt;
  const votingClosed = closesAt !== null && Date.parse(closesAt) <= now;
  return d.kind === 'live' && (d.myVote?.after || votingClosed) ? 'revealed' : 'hidden';
}

export interface Outcome {
  headline: string;
  judge: string;
  audience: string | null;
  split: boolean;
}

interface OutcomeInput {
  kind: 'live' | 'batch';
  debaters: Record<Side, Debater>;
  verdict: { winner: Side } | null;
  audienceResult: OxfordResult;
}

/** The outcome in words: who carried or defeated the Motion, by the Judge and (live Debates) the audience. */
export function outcome(d: OutcomeInput, models: ModelInfo[]): Outcome | null {
  if (!d.verdict) return null;
  const { winner } = d.verdict;
  const result = d.audienceResult;
  const counted = d.kind === 'live' && result.counted > 0;
  const split = counted && result.winner !== 'tie' && result.winner !== winner;
  const model = debaterLabel(d.debaters[winner], models);
  const headline = split
    ? t('outcome.split')
    : t(winner === 'for' ? 'outcome.carries' : 'outcome.defeats', { model });
  let audience: string | null = null;
  if (d.kind === 'live') {
    if (!counted) audience = t('outcome.audienceNone');
    else if (result.winner === 'tie') audience = t('outcome.audienceTied');
    else audience = t('outcome.audience', { side: sideLabel(result.winner), points: signed(result.swing[result.winner]) });
  }
  return { headline, judge: t('outcome.judge', { side: sideLabel(winner) }), audience, split };
}
