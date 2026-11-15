// Pure view helpers for Debates, shared by pages and islands.
import type { DebateSummary } from '@debate-arena/api-client';
import { countWords, dominantScript, isSelfJudging, type Debater, type OxfordResult, type Phase, type Script, type Side, type Turn } from '@debate-arena/engine';
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

/** The Turn being written in a slot, as far as it has got. */
export interface Draft {
  slotIndex: number;
  text: string;
}

/**
 * The draft to show after a draft event, with `finished` Turns on the floor. Only the next slot is being written:
 * a draft for a finished slot arrived late and must not come back under its speech; empty text clears the draft.
 */
export function applyDraft(_current: Draft | null, event: Draft, finished: number): Draft | null {
  if (event.text === '' || event.slotIndex !== finished) return null;
  return { slotIndex: event.slotIndex, text: event.text };
}

/**
 * A draft cut off inside emphasis, closed so it already shows as emphasis: "a **strong po" reads as "a **strong po**",
 * and a marker with nothing after it yet is held back, so a speech being written never flashes its asterisks.
 */
export function closeEmphasis(text: string): string {
  let out = text.replace(/\*+$/, '');
  for (const marker of ['**', '*']) {
    const plain = marker === '*' ? out.replaceAll('**', '') : out;
    if (plain.split(marker).length % 2 === 1) continue; // every marker has its pair
    // The open run must hug non-space text, as inlineEmphasis needs, or it is a lone asterisk, not emphasis.
    const after = out.slice(out.lastIndexOf(marker) + marker.length);
    if (/^\S/.test(after)) out = `${out.trimEnd()}${marker}`;
  }
  return out;
}

/** A run of a paragraph's text, plain or with the emphasis the model marked with asterisks. */
export interface TextRun {
  text: string;
  style?: 'em' | 'strong';
}

// **strong** or *em*, hugging non-space text on both sides, so "5 * 3" and a lone "*" stay as they are.
const EMPHASIS = /\*\*(?=\S)(.+?)(?<=\S)\*\*|\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*/g;

/** Splits a paragraph into runs, so the Markdown emphasis models write shows as emphasis, never as asterisks. */
export function inlineEmphasis(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let at = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push(match[1] !== undefined ? { text: match[1], style: 'strong' } : { text: match[2]!, style: 'em' });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

/** About how much of a speech its preview shows: enough to reach the argument past a greeting. */
export const PREVIEW_WORDS = 60;
/** A rest shorter than this is shown too: a disclosure for a sentence or two only costs a click. */
const SHORT_TAIL_WORDS = 25;

/** How many of a speech's paragraphs show before "Read the full speech". */
export function previewLength(paragraphs: string[]): number {
  let words = 0;
  let shown = 0;
  while (shown < paragraphs.length && words < PREVIEW_WORDS) words += countWords(paragraphs[shown++]!);
  const rest = paragraphs.slice(shown).reduce((sum, p) => sum + countWords(p), 0);
  return rest < SHORT_TAIL_WORDS ? paragraphs.length : shown;
}

// The most likely language of each script, for a `lang` attribute. Han without kana is read as Chinese.
const SCRIPT_LANG: Partial<Record<Script, string>> = {
  hangul: 'ko',
  cyrillic: 'ru',
  greek: 'el',
  arabic: 'ar',
  hebrew: 'he',
  devanagari: 'hi',
  thai: 'th',
};

/**
 * The language of a text written in another script than the Motion (a Judge that answered in the wrong
 * language), for its `lang` attribute; undefined when it shares the Motion's script or has no letters.
 */
export function otherLanguage(text: string, motion: string): string | undefined {
  const script = dominantScript(text);
  if (script === null || script === dominantScript(motion)) return undefined;
  if (script === 'cjk') return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? 'ja' : 'zh';
  return SCRIPT_LANG[script];
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

/** Each Side's Swing as a bar on its half of the axis: 100 points fill the half, larger Swings are capped. */
export function swingBars(result: Pick<OxfordResult, 'swing'>): Record<Side, { points: number; width: string }> {
  const bar = (swing: number) => {
    const points = Math.round(swing * 10) / 10 || 0;
    return { points, width: `${Math.min(Math.abs(points), 100) / 2}%` };
  };
  return { for: bar(result.swing.for), against: bar(result.swing.against) };
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

/** Quota points a Member gets each UTC day (the API's DAILY_QUOTA_POINTS). What a Debate costs, the API quotes. */
export const DAILY_QUOTA_POINTS = 24;

const PROVIDERS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  'meta-llama': 'Meta',
  qwen: 'Qwen',
  mistralai: 'Mistral AI',
  'x-ai': 'xAI',
};

/** The provider, from the model id's prefix ("anthropic/claude-…" → "Anthropic"). */
export function providerName(id: string): string {
  const prefix = id.split('/')[0] ?? '';
  return PROVIDERS[prefix] ?? prefix.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** A price in USD per million tokens: two decimals, three below ten cents ("0.15", "0.047", "5.00"). */
export function formatPrice(usdPerMTok: number): string {
  return usdPerMTok > 0 && usdPerMTok < 0.1 ? usdPerMTok.toFixed(3) : usdPerMTok.toFixed(2);
}
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
  if (debater.kind === 'api') return t('debater.api');
  return debater.kind === 'ai' ? modelLabel(debater.model, models) : debater.memberId;
}

export type MotionSize = 'l' | 'm' | 's';

/** The Motion's type size on the band: long Motions step down so the benches stay in view. */
export function motionSize(text: string): MotionSize {
  return text.length <= 120 ? 'l' : text.length <= 200 ? 'm' : 's';
}

/** The slot after `count` Turns in the Format's speaking order, or null once every slot is filled. */
export function nextSpeaker(format: { phases: { order: Side[] }[] }, count: number): { phaseIndex: number; side: Side } | null {
  const slots = format.phases.flatMap((phase, phaseIndex) => phase.order.map(side => ({ phaseIndex, side })));
  return slots[count] ?? null;
}

export function spokeCount(turns: Pick<Turn, 'side'>[], side: Side): number {
  return turns.filter(turn => turn.side === side).length;
}

interface RevealInput {
  kind: 'live' | 'batch';
  status: 'running' | 'complete' | 'failed';
  /** When Audience voting closes (null while running or failed; missing from an older API). */
  votingClosesAt?: string | null | undefined;
  myVote?: { before?: unknown; after: unknown } | null | undefined;
}

/**
 * The hybrid rule (spec: Outcome revealed): the outcome is hidden while Audience voting is open and this
 * reader has not cast their after-vote, so it cannot sway the vote; otherwise it is shown openly everywhere.
 * A Batch Debate takes no Audience Votes and a failed one takes no more, so theirs is never hidden.
 *
 * Fails closed: a complete live Debate without a closing time keeps its outcome hidden. Every Format has an
 * Oxford voting window and the API sends votingClosesAt null only while a Debate runs or once it failed
 * (apps/api votes/rules.ts), so null on a complete live Debate does not mean "no voting": it is a record without
 * a completion time, for which the API keeps voting open too (checkVote). Absent (an older API) is treated the same.
 */
export function outcomeHidden(d: RevealInput, now = Date.now()): boolean {
  if (d.kind === 'batch' || d.status === 'failed' || d.myVote?.after) return false;
  if (d.status === 'running' || d.votingClosesAt == null) return true;
  return Date.parse(d.votingClosesAt) > now;
}

/**
 * The order paper's outcome: "Carried" / "Defeated" by the Verdict, or "Voting open" while the outcome is hidden.
 * The home feed is public and the same for every reader (so it can be cached): it carries no votes of the reader,
 * so it follows the public rule, hidden until voting closes and shown for Batch Debates, whatever the reader voted.
 */
export function feedOutcome(d: RevealInput & { verdict: { winner: Side } | null }, now = Date.now()): 'carried' | 'defeated' | 'votingOpen' | null {
  if (!d.verdict) return null;
  if (outcomeHidden({ ...d, myVote: null }, now)) return 'votingOpen';
  return d.verdict.winner === 'for' ? 'carried' : 'defeated';
}

export type DispatchState =
  | 'ask'
  | 'generating'
  | 'live'
  | 'audienceFailed'
  | 'judgingFailed'
  | 'failed'
  | 'revealed'
  | 'askAfter'
  | 'hidden';

interface DispatchInput {
  kind: 'live' | 'batch';
  status: 'running' | 'complete' | 'failed';
  turnsHidden: boolean;
  turns: unknown[];
  myVote: { before: unknown; after: unknown } | null;
  verdict: unknown;
  audienceResult: { votingClosesAt: string | null };
}

/**
 * What the dispatch box shows (spec: the dispatch box table, first match wins). A failed Debate can still have
 * its Verdict (the AI Audience step failed after it was saved), which is shown under the floor. Once complete
 * the outcome follows the hybrid rule (outcomeHidden): open, or folded away with the after-vote asked for when due.
 */
export function dispatchState(d: DispatchInput, now = Date.now()): DispatchState {
  if (d.turnsHidden) return 'ask';
  if (d.kind === 'batch' && d.status === 'running') return 'generating';
  if (d.status === 'running') return 'live';
  if (d.status === 'failed') return d.verdict ? 'audienceFailed' : d.turns.length > 0 ? 'judgingFailed' : 'failed';
  if (!outcomeHidden({ ...d, votingClosesAt: d.audienceResult.votingClosesAt }, now)) return 'revealed';
  return d.myVote?.before ? 'askAfter' : 'hidden';
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
