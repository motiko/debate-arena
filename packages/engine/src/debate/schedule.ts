import type { Format, Turn, TurnSlot } from '../domain';

/** Average tokens per word, used for output caps and Budget estimates. */
export const TOKENS_PER_WORD = 1.4;

/** Words to tokens, rounded up; rounds away float noise first (10 * 1.4 is 14.000000000000002 in JS). */
export function wordsToTokens(words: number): number {
  return Math.ceil(Number((words * TOKENS_PER_WORD).toFixed(6)));
}

export function turnSlots(format: Format): TurnSlot[] {
  return format.phases.flatMap((phase, phaseIndex) => phase.order.map(side => ({ phaseIndex, side })));
}

export function nextSlot(format: Format, turns: Turn[]): TurnSlot | null {
  return turnSlots(format)[turns.length] ?? null;
}
