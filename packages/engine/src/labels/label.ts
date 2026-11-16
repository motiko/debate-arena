import { UNTRUSTED_NOTICE } from '../debate/prompts';
import type { ModelId } from '../domain';
import type { ModelClient, ModelMessage } from '../models/client';

/** The Categories a Debate can be in (GLOSSARY: Category), in the order Viewers see them. */
export const CATEGORIES = ['politics', 'economics', 'technology', 'science', 'health', 'environment', 'philosophy', 'society', 'culture', 'sport'] as const;
export type Category = (typeof CATEGORIES)[number];

/** A Debate's Category and its 0–3 Tags, as the labeller assigned them. */
export interface Labels { category: Category; tags: string[] }

/** A short JSON object. Distinct from the other output caps, so fakes can tell a labelling call apart. */
export const LABEL_OUTPUT_TOKENS = 80;
export const MAX_TAGS = 3;
const TAG_MIN = 2;
const TAG_MAX = 24;

export const isCategory = (value: unknown): value is Category => typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);

export function buildLabelMessages(motion: string): ModelMessage[] {
  return [
    {
      role: 'user',
      content:
        `${UNTRUSTED_NOTICE}\nLabel this Motion of a public debate. Choose exactly one category from: ${CATEGORIES.join(', ')}. ` +
        `Add one to ${MAX_TAGS} short lower-case topic tags of one to three words, in English, ASCII letters only. ` +
        `Answer with JSON only, like {"category": "technology", "tags": ["remote work"]}.\n` +
        `Motion: ${JSON.stringify(motion)}`,
    },
  ];
}

/**
 * A Tag as stored: lower case, letters, digits, spaces and hyphens, single-spaced; null when nothing usable is left,
 * or when it has letters outside English, which stripping would mangle ("Ökonomie" → "konomie").
 */
export function normaliseTag(raw: string): string | null {
  if (/\p{L}/u.test(raw.replace(/[a-z]/gi, ''))) return null;
  const tag = raw
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return tag.length >= TAG_MIN && tag.length <= TAG_MAX ? tag : null;
}

/** Reads the labeller's answer: the first JSON object in it. An unknown Category or unreadable answer gives null. */
export function parseLabels(text: string): Labels | null {
  // From the first "{" to the last "}", found by index: a regex here backtracks quadratically on a reply of braces.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const json = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { category, tags } = parsed as Record<string, unknown>;
  const lower = typeof category === 'string' ? category.trim().toLowerCase() : null;
  if (!isCategory(lower) || !Array.isArray(tags)) return null;
  const cleaned = [...new Set(tags.flatMap(t => (typeof t === 'string' ? (normaliseTag(t) ?? []) : [])))];
  return { category: lower, tags: cleaned.slice(0, MAX_TAGS) };
}

/**
 * Labels a Motion with a Category and Tags. A failed call or an unreadable answer gives null, so labelling never
 * fails a Debate; only errors the host marks with `rethrow` (e.g. a used-up Budget) escape.
 */
export async function labelMotion(
  motion: string,
  model: ModelId,
  client: ModelClient,
  options: { rethrow?: (error: unknown) => boolean } = {},
): Promise<Labels | null> {
  try {
    const response = await client.complete({ model, messages: buildLabelMessages(motion), maxOutputTokens: LABEL_OUTPUT_TOKENS });
    return parseLabels(response.text);
  } catch (error) {
    if (options.rethrow?.(error)) throw error;
    return null;
  }
}
