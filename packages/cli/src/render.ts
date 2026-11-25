// Plain-text rendering of Debates for the terminal: no colour or control characters, so output pipes cleanly.
import type { PublicDebate } from '@debate-arena/api-client';

type Side = 'for' | 'against';
type Debater = PublicDebate['debaters'][Side];
type Turn = PublicDebate['turns'][number];
type AiAudience = NonNullable<PublicDebate['aiAudience']>;

const SIDE_LABEL: Record<Side, string> = { for: 'For', against: 'Against' };
const STATUS_LABEL: Record<PublicDebate['status'], string> = { running: 'Running', complete: 'Complete', failed: 'Failed' };

/** A Custom Debater's model is shown as self-reported: the platform never checks it. */
function customName(debater: { name?: string | undefined; model?: string | undefined }): string {
  const model = debater.model ? `self-reported model: ${debater.model}` : '';
  if (debater.name) return `${debater.name} (${['Custom', model].filter(Boolean).join(', ')})`;
  return model ? `Custom Debater (${model})` : 'Custom Debater';
}

const debaterName = (debater: Debater) => (debater.kind === 'ai' ? debater.model : debater.kind === 'api' ? customName(debater) : 'a Member');

/** "Waiting for For's Turn via the API until 12:10 UTC". */
export function renderAwaiting(side: Side, deadline: string): string {
  return `Waiting for ${SIDE_LABEL[side]}'s Turn via the API until ${deadline.slice(11, 16)} UTC\n`;
}
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export const debateUrl = (base: string, id: string) => `${base}/debates/${encodeURIComponent(id)}`;

export function turnHeader(debate: PublicDebate, slot: { phaseIndex: number; side: Side }): string {
  const phase = debate.format.phases[slot.phaseIndex]?.name ?? `Phase ${slot.phaseIndex + 1}`;
  return `── ${phase} · ${SIDE_LABEL[slot.side]} · ${debaterName(debate.debaters[slot.side])} ──`;
}

export function renderTurn(debate: PublicDebate, turn: Turn): string {
  return `${turnHeader(debate, turn)}\n${turn.text}${turn.truncated ? ' (cut at the word limit)' : ''}\n`;
}

const CONFIDENCE_LABEL = { clear: 'clear', likely: 'likely', narrow: 'too close to call' } as const;

/**
 * Whether the Motion stands, how sure, and the Panel's split (ADR 0008); then the crux, the Judge's Rubric Scores
 * (one line per criterion), the reasoning and the checked claims. A Verdict from before ADR 0008, or from a server
 * that sends none of this, prints as "<Side> wins".
 */
export function renderVerdict(verdict: NonNullable<PublicDebate['verdict']>): string {
  // A server from before Rubric Scores sends none; one from before ADR 0008, no confidence, crux, claims or Ballots.
  const scores = (verdict.scores ?? []).map(s => `  ${s.criterion}: For ${s.for} · Against ${s.against}\n`).join('');
  const judges = verdict.judges.join(', ');
  if (!verdict.confidence) return `Verdict: ${SIDE_LABEL[verdict.winner]} wins (${judges})\n${scores}${verdict.reasoning}\n`;
  const ballots = verdict.ballots ?? [];
  const split = ballots.length > 1
    ? ` · Panel ${ballots.filter(b => b.winner === 'for').length}–${ballots.filter(b => b.winner === 'against').length}`
    : '';
  const motion = verdict.winner === 'for' ? 'stands' : 'falls';
  const head = `Verdict: the Motion ${motion} (${SIDE_LABEL[verdict.winner]}), ${CONFIDENCE_LABEL[verdict.confidence]}${split} (${judges})\n`;
  const crux = verdict.crux ? `Crux: ${verdict.crux}\n` : '';
  const claims = (verdict.claims ?? []).map(c => `  [${c.status}] ${SIDE_LABEL[c.side]}: ${c.claim}${c.note ? ` — ${c.note}` : ''}\n`).join('');
  return `${head}${crux}${scores}${verdict.reasoning}\n${claims}`;
}

const STANCE_LABEL: Record<AiAudience['votes'][number]['before'], string> = { ...SIDE_LABEL, undecided: 'Undecided' };

/** The AI Audience Result, then each AI Voter's model and its before → after stance. */
export function renderAiAudience(result: AiAudience): string {
  const outcome = result.winner === 'tie' ? 'a tie' : `${SIDE_LABEL[result.winner]} wins`;
  const votes = result.votes.map(v => `  ${v.model}: ${STANCE_LABEL[v.before]} → ${STANCE_LABEL[v.after]}\n`).join('');
  return `AI Audience: ${outcome} (swing For ${signed(result.swing.for)}, Against ${signed(result.swing.against)})\n${votes}`;
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
