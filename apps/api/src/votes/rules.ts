import { computeOxfordResult, type OxfordResult, type VoterStances } from '@debate-arena/engine';
import type { DebateRecord } from '../db/debates';
import type { AudienceVote } from '../db/votes';

const DAY_MS = 24 * 60 * 60 * 1000;

export type VotePhase = 'before' | 'after';
export type VoteCheck = { ok: true } | { ok: false; status: 403 | 409; error: string };

export const VOTING_CLOSED = 'Voting is closed for this Debate';

/** When the Format's voting window closes: windowDays after completion. Null while running or failed. */
export function votingClosesAt(debate: DebateRecord): string | null {
  if (debate.status !== 'complete' || !debate.completedAt) return null;
  const windowDays = debate.setup.format.votingMethod.windowDays;
  return new Date(Date.parse(debate.completedAt) + windowDays * DAY_MS).toISOString();
}

/**
 * Oxford rules: a before-vote while the Debate runs or its window is open; an after-vote only once it is
 * complete, within the window, after a before-vote. Each stance is cast once.
 */
export function checkVote(debate: DebateRecord, existing: AudienceVote | null, phase: VotePhase, now: Date): VoteCheck {
  // GLOSSARY: Batch Debate — its outcome is the Verdict (and any AI Audience Result), never Audience Votes.
  if (debate.kind === 'batch') return { ok: false, status: 403, error: 'Batch Debates take no Audience Votes' };
  const closesAt = votingClosesAt(debate);
  if (debate.status === 'failed' || (closesAt && now.getTime() >= Date.parse(closesAt))) {
    return { ok: false, status: 403, error: VOTING_CLOSED };
  }
  if (phase === 'before') {
    return existing ? { ok: false, status: 409, error: 'You already voted before this Debate' } : { ok: true };
  }
  if (debate.status !== 'complete') return { ok: false, status: 403, error: 'Vote again when the Debate is complete' };
  if (!existing) return { ok: false, status: 403, error: 'Vote before reading the Debate first' };
  if (existing.after) return { ok: false, status: 409, error: 'You already voted after this Debate' };
  return { ok: true };
}

/** The Audience Result: the Oxford Swing over Members who voted both before and after. */
export function audienceResult(debate: DebateRecord, votes: AudienceVote[]): OxfordResult & { votingClosesAt: string | null } {
  const stances: VoterStances[] = votes.map(v => ({
    voterId: v.memberId,
    ...(v.before ? { before: v.before } : {}),
    ...(v.after ? { after: v.after } : {}),
  }));
  return { ...computeOxfordResult(stances), votingClosesAt: votingClosesAt(debate) };
}
