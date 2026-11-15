// Plain-text rendering of Debates for the terminal: no colour or control characters, so output pipes cleanly.
import type { PublicDebate } from '@debate-arena/api-client';

type Side = 'for' | 'against';
type Debater = PublicDebate['debaters'][Side];
type Turn = PublicDebate['turns'][number];
type AiAudience = NonNullable<PublicDebate['aiAudience']>;

const SIDE_LABEL: Record<Side, string> = { for: 'For', against: 'Against' };
const STATUS_LABEL: Record<PublicDebate['status'], string> = { running: 'Running', complete: 'Complete', failed: 'Failed' };

const debaterName = (debater: Debater) => (debater.kind === 'ai' ? debater.model : 'a Member');
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export const debateUrl = (base: string, id: string) => `${base}/debates/${encodeURIComponent(id)}`;

export function turnHeader(debate: PublicDebate, slot: { phaseIndex: number; side: Side }): string {
  const phase = debate.format.phases[slot.phaseIndex]?.name ?? `Phase ${slot.phaseIndex + 1}`;
  return `── ${phase} · ${SIDE_LABEL[slot.side]} · ${debaterName(debate.debaters[slot.side])} ──`;
}

export function renderTurn(debate: PublicDebate, turn: Turn): string {
  return `${turnHeader(debate, turn)}\n${turn.text}${turn.truncated ? ' (cut at the word limit)' : ''}\n`;
}

export function renderVerdict(verdict: NonNullable<PublicDebate['verdict']>): string {
  return `Verdict: ${SIDE_LABEL[verdict.winner]} wins (${verdict.judges.join(', ')})\n${verdict.reasoning}\n`;
}

export function renderAiAudience(result: AiAudience): string {
  const outcome = result.winner === 'tie' ? 'a tie' : `${SIDE_LABEL[result.winner]} wins`;
  return `AI Audience: ${outcome} (swing For ${signed(result.swing.for)}, Against ${signed(result.swing.against)})\n`;
}

export const renderVoteLink = (base: string, id: string) => `Read and vote: ${debateUrl(base, id)}\n`;

/** The Motion, Debaters and status. */
export const renderHeader = (debate: PublicDebate) =>
  `${debate.motion}\nFor: ${debaterName(debate.debaters.for)} · Against: ${debaterName(debate.debaters.against)}\n${STATUS_LABEL[debate.status]}\n`;

export function renderDebate(debate: PublicDebate, base: string): string {
  const parts = [renderHeader(debate), ...debate.turns.map(turn => renderTurn(debate, turn))];
  if (debate.verdict) parts.push(renderVerdict(debate.verdict));
  if (debate.aiAudience) parts.push(renderAiAudience(debate.aiAudience));
  parts.push(renderVoteLink(base, debate.id));
  return parts.join('\n');
}
