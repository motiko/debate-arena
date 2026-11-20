import { CATEGORIES } from '@debate-arena/engine';
import { t, type MessageKey } from '../i18n/t';

export { CATEGORIES };

/** The feed's own query parameters (the API reads the same names and drops anything it cannot use). */
export interface FeedParams {
  q?: string;
  category?: string;
  /** Read from, and written as, the repeated `tag` parameter. */
  tags?: string[];
  model?: string;
  kind?: string;
  page?: number;
}

/** How many Tags a feed can be filtered by at once (the API keeps no more). */
export const MAX_FILTER_TAGS = 5;

/** Feed parameters to set; an undefined one is removed. */
export type FeedChange = { [K in keyof FeedParams]?: FeedParams[K] | undefined };

// In the order they appear in a link; the Tags come after the Category.
const KEYS = ['q', 'category', 'model', 'kind'] as const;

/** The feed parameters in a URL: trimmed, empty ones dropped, a page only when it is a whole number above 1. */
export function feedParams(search: URLSearchParams): FeedParams {
  const params: FeedParams = {};
  for (const key of KEYS) {
    const value = search.get(key)?.trim();
    if (value) params[key] = value;
  }
  const tags = [...new Set(search.getAll('tag').map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 0) params.tags = tags;
  const page = search.get('page') ?? '';
  if (/^\d+$/.test(page) && Number(page) > 1) params.page = Number(page);
  return params;
}

/**
 * A feed link: the current parameters with `change` applied. Changing a filter goes back to the first page, as the
 * old page number would mean nothing in the new list; page 1 is left out.
 */
export function feedHref(current: FeedChange, change: FeedChange): string {
  const next: FeedChange = { ...current, ...change };
  if (!('page' in change)) delete next.page;
  const search = new URLSearchParams();
  for (const key of KEYS) {
    if (next[key]) search.set(key, next[key]);
    if (key === 'category') for (const tag of next.tags ?? []) search.append('tag', tag);
  }
  if (next.page && next.page > 1) search.set('page', String(next.page));
  const query = search.toString();
  return query ? `/?${query}` : '/';
}

/** The page numbers to link: the first, the last, and the current page with its neighbours; 'gap' where some are left out. */
export function pageList(page: number, pageCount: number): (number | 'gap')[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pageCount])].filter(n => n >= 1 && n <= pageCount).toSorted((a, b) => a - b);
  return shown.flatMap((n, i) => (i > 0 && n - shown[i - 1]! > 1 ? ['gap' as const, n] : [n]));
}

/** A Category's name for Viewers; an unknown one is shown as it came. */
export function categoryLabel(category: string): string {
  return (CATEGORIES as readonly string[]).includes(category) ? t(`category.${category}` as MessageKey) : category;
}

/** The feed parameters for the query the API says it applied (anything it could not use already dropped). */
export function appliedParams(query: Omit<FeedParams, 'page'> & { page: number }): FeedParams {
  const { page, ...filters } = query;
  return page > 1 ? { ...filters, page } : filters;
}
