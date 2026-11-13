import type { Format, Turn, TurnSlot } from '../domain';

/** Average tokens per word, used for output caps and Budget estimates. */
export const TOKENS_PER_WORD = 1.4;

/** Words to tokens, rounded up; rounds away float noise first (10 * 1.4 is 14.000000000000002 in JS). */
export function wordsToTokens(words: number): number {
  return Math.ceil(Number((words * TOKENS_PER_WORD).toFixed(6)));
}

/**
 * Output token cap for a Turn. Twice the average, so the Phase's word limit (not the token cap) is what
 * cuts a Turn, even in scripts that use more tokens per word.
 */
export const OUTPUT_HEADROOM = 2;
export function turnOutputCap(maxWords: number): number {
  return wordsToTokens(maxWords) * OUTPUT_HEADROOM;
}

/** Calls per Judge or AI Voter stance (one retry on an unparseable reply); also reserved per Turn for job retries. */
export const MAX_ATTEMPTS = 2;

export function turnSlots(format: Format): TurnSlot[] {
  return format.phases.flatMap((phase, phaseIndex) => phase.order.map(side => ({ phaseIndex, side })));
}

export function nextSlot(format: Format, turns: Turn[]): TurnSlot | null {
  return turnSlots(format)[turns.length] ?? null;
}
