// Pure view helpers for Debates, shared by pages and islands.
import type { DebateSummary } from '@debate-arena/api-client';
import type { OxfordResult, Phase, Side, Turn } from '@debate-arena/engine';
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

export function modelLabel(id: string, models: ModelInfo[] = []): string {
  return models.find(m => m.id === id)?.label ?? id;
}
