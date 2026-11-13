// Pure view helpers for Debates, shared by pages and islands.
import type { DebateSummary } from '@debate-arena/api-client';
import type { Side } from '@debate-arena/engine';
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

export function modelLabel(id: string, models: ModelInfo[] = []): string {
  return models.find(m => m.id === id)?.label ?? id;
}
