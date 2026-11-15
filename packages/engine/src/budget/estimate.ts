import { MAX_ATTEMPTS, turnOutputCap, turnSlots } from '../debate/schedule';
import type { DebateSetup, ModelId } from '../domain';
import { UnknownModelPriceError } from '../errors';
import { JUDGE_OUTPUT_TOKENS } from '../judging/judge';
import { SCREEN_OUTPUT_TOKENS } from '../moderation/screen';
import { STANCE_OUTPUT_TOKENS } from '../voting/ai-voter';

export { JUDGE_OUTPUT_TOKENS, STANCE_OUTPUT_TOKENS };

export interface ModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  /** Output tokens reserved on every call beyond the asked cap: a mandatory-reasoning model's reasoning allowance. */
  extraOutputTokens?: number;
}
export type PriceTable = Record<ModelId, ModelPrice>;

export const PROMPT_OVERHEAD_TOKENS = 600;

/** A Quota point buys this much worst-case Budget: 1.25 US cents. */
export const QUOTA_POINT_MICRO_USD = 12_500;

/** The Quota points a Debate costs: one per QUOTA_POINT_MICRO_USD of its worst-case Budget, rounded up, at least 1. */
export function quotaPointsFor(budgetMicroUsd: number): number {
  return Math.max(1, Math.ceil(budgetMicroUsd / QUOTA_POINT_MICRO_USD));
}

/** UTF-8 byte length: an upper bound on tokens for any script, since a token covers at least one byte. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const isValidPrice = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function priceOf(prices: PriceTable, model: ModelId): ModelPrice {
  const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
  if (!price || !isValidPrice(price.inputPerMTokUsd) || !isValidPrice(price.outputPerMTokUsd))
    throw new UnknownModelPriceError(`No valid price for ${model}`);
  return price;
}

/**
 * Worst-case AI cost of a Debate in micro-USD: every Turn at its output cap and every call made
 * MAX_ATTEMPTS times. Reserved from the Member's Quota before the Debate starts; unused cost is returned.
 * With a `screener`, one Motion screening call is included.
 */
export function worstCaseBudgetMicroUsd(setup: DebateSetup, aiVoters: ModelId[], prices: PriceTable, screener?: ModelId): number {
  // tokens × USD per million tokens = micro-USD
  const cost = (model: ModelId, input: number, output: number) => {
    const price = priceOf(prices, model);
    return MAX_ATTEMPTS * (input * price.inputPerMTokUsd + (output + (price.extraOutputTokens ?? 0)) * price.outputPerMTokUsd);
  };

  const base = PROMPT_OVERHEAD_TOKENS + utf8Length(setup.motion.text);
  let transcript = 0;
  let total = screener ? cost(screener, base, SCREEN_OUTPUT_TOKENS) : 0;

  for (const slot of turnSlots(setup.format)) {
    const output = turnOutputCap(setup.format.phases[slot.phaseIndex]!.maxWords);
    const debater = setup.debaters[slot.side];
    if (debater.kind === 'ai') total += cost(debater.model, base + transcript, output);
    // Each API Turn is screened, as a Motion is: its text is at most the Turn's output cap.
    if (debater.kind === 'api' && screener) total += cost(screener, base + output, SCREEN_OUTPUT_TOKENS);
    transcript += output;
  }
  for (const judge of setup.panel) total += cost(judge, base + transcript, JUDGE_OUTPUT_TOKENS);
  for (const voter of aiVoters) {
    total += cost(voter, base, STANCE_OUTPUT_TOKENS);
    total += cost(voter, base + transcript, STANCE_OUTPUT_TOKENS);
  }
  return Math.ceil(total);
}
