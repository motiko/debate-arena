import { UNTRUSTED_NOTICE } from '../debate/prompts';
import type { ModelId } from '../domain';
import type { ModelClient, ModelMessage } from '../models/client';

/** A Llama Guard-style verdict: "unsafe" and a few hazard codes. Distinct from the stance cap, so fakes can tell them apart. */
export const SCREEN_OUTPUT_TOKENS = 16;

/**
 * Hazard categories (MLCommons, as used by Llama Guard) that Flag a Motion: violent crimes, sex-related crimes,
 * child sexual exploitation, indiscriminate weapons, hate, suicide and self-harm, sexual content. Others (crime in
 * general, defamation, advice, privacy, elections…) are recorded but do not Flag: Motions may debate them.
 */
export const FLAG_CATEGORIES = ['S1', 'S3', 'S4', 'S9', 'S10', 'S11', 'S12'] as const;

/** `categories` names every S-code the screener gave, or 'unscreened' when its answer could not be read. */
export interface ScreenResult { flagged: boolean; categories: string[] }

const UNSCREENED: ScreenResult = { flagged: true, categories: ['unscreened'] };

/** What is screened: a Motion, or an API Debater's Turn (a speech nobody on the platform generated). */
export type ScreenedText = 'motion' | 'turn';

export function buildScreenMessages(text: string, what: ScreenedText = 'motion'): ModelMessage[] {
  const label = what === 'turn' ? 'Speech submitted to a public debate' : 'Motion proposed for a public debate';
  return [{ role: 'user', content: `${UNTRUSTED_NOTICE}\n${label}: ${JSON.stringify(text)}` }];
}

/**
 * Reads the screener's answer: "safe", or "unsafe" then the S-codes. Anything else counts as unscreened, which
 * Flags, so a Moderator looks at it. A Flag only Unlists; it never removes anything.
 */
export function parseScreen(text: string): ScreenResult {
  const [first, second] = text.trim().split('\n').map(line => line.trim().toLowerCase());
  if (first === 'safe') return { flagged: false, categories: [] };
  if (first !== 'unsafe' || !second) return UNSCREENED;
  const codes = second.split(',').map(code => code.trim().toUpperCase());
  if (codes.length === 0 || !codes.every(code => /^S\d{1,2}$/.test(code))) return UNSCREENED;
  return { flagged: codes.some(code => (FLAG_CATEGORIES as readonly string[]).includes(code)), categories: codes };
}

/**
 * Screens a Motion. A failed call counts as unscreened, so screening never fails a Debate; only errors the
 * host marks with `rethrow` (e.g. a used-up Budget) escape.
 */
export async function screenMotion(
  motion: string,
  model: ModelId,
  client: ModelClient,
  options: { rethrow?: (error: unknown) => boolean; what?: ScreenedText } = {},
): Promise<ScreenResult> {
  try {
    const response = await client.complete({ model, messages: buildScreenMessages(motion, options.what), maxOutputTokens: SCREEN_OUTPUT_TOKENS });
    return parseScreen(response.text);
  } catch (error) {
    if (options.rethrow?.(error)) throw error;
    return UNSCREENED;
  }
}
