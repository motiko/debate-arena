import { MAX_CUSTOM_MODEL_LENGTH, MAX_CUSTOM_NAME_LENGTH } from '../debate/custom-identity';
import { MAX_ATTEMPTS, turnOutputCap, turnSlots } from '../debate/schedule';
import type { DebateSetup, ModelId } from '../domain';
import { UnknownModelPriceError } from '../errors';
import { JUDGE_OUTPUT_TOKENS } from '../judging/judge';
import { LABEL_OUTPUT_TOKENS } from '../labels/label';
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

/**
 * An API Debater's Turn may be at most this many bytes per word of its Phase. Its words are not a model's output,
 * so its token cap does not bound it: its bytes do (a token covers at least one byte), and the Budget reads it so.
 */
export const API_TURN_BYTES_PER_WORD = 8;
export const apiTurnMaxBytes = (maxWords: number) => maxWords * API_TURN_BYTES_PER_WORD;

/** The most bytes a Custom Debater's screened identity can be: 4 per character of the longest name and model, plus labels. */
export const IDENTITY_MAX_BYTES = 4 * (MAX_CUSTOM_NAME_LENGTH + MAX_CUSTOM_MODEL_LENGTH) + 16;

/** A Quota point buys this much worst-case Budget: 1.25 US cents. */
export const QUOTA_POINT_MICRO_USD = 12_500;

/** The Quota points a Debate costs: one per QUOTA_POINT_MICRO_USD of its worst-case Budget, rounded up, at least 1. */
export function quotaPointsFor(budgetMicroUsd: number): number {
  if (!Number.isFinite(budgetMicroUsd) || budgetMicroUsd < 0) throw new RangeError(`Not a Budget: ${budgetMicroUsd}`);
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
  if (
    !price ||
    !isValidPrice(price.inputPerMTokUsd) ||
    !isValidPrice(price.outputPerMTokUsd) ||
    (price.extraOutputTokens !== undefined && !isValidPrice(price.extraOutputTokens))
  )
    throw new UnknownModelPriceError(`No valid price for ${model}`);
  return price;
}

/**
 * Worst-case AI cost of a Debate in micro-USD: every Turn at its output cap and every call made
 * MAX_ATTEMPTS times. Reserved from the Member's Quota before the Debate starts; unused cost is returned.
 * With a `screener`, one Motion screening call is included; with a `labeller`, one Motion labelling call.
 */
export function worstCaseBudgetMicroUsd(setup: DebateSetup, aiVoters: ModelId[], prices: PriceTable, screener?: ModelId, labeller?: ModelId): number {
  // tokens × USD per million tokens = micro-USD
  const cost = (model: ModelId, input: number, output: number) => {
    const price = priceOf(prices, model);
    return MAX_ATTEMPTS * (input * price.inputPerMTokUsd + (output + (price.extraOutputTokens ?? 0)) * price.outputPerMTokUsd);
  };

  const base = PROMPT_OVERHEAD_TOKENS + utf8Length(setup.motion.text);
  let transcript = 0;
  let total = screener ? cost(screener, base, SCREEN_OUTPUT_TOKENS) : 0;
  if (labeller) total += cost(labeller, base, LABEL_OUTPUT_TOKENS);

  for (const slot of turnSlots(setup.format)) {
    const maxWords = setup.format.phases[slot.phaseIndex]!.maxWords;
    const debater = setup.debaters[slot.side];
    // An AI Turn is at most its output cap in tokens; an API Turn at most its byte cap, which bounds its tokens.
    const length = debater.kind === 'api' ? apiTurnMaxBytes(maxWords) : turnOutputCap(maxWords);
    if (debater.kind === 'ai') total += cost(debater.model, base + transcript, length);
    // Each API Turn is screened, as a Motion is.
    if (debater.kind === 'api' && screener) total += cost(screener, base + length, SCREEN_OUTPUT_TOKENS);
    transcript += length;
  }
  // A Custom Debater's nickname and model, given at start, are screened once with the Motion.
  for (const debater of Object.values(setup.debaters)) {
    if (debater.kind === 'api' && (debater.name || debater.model) && screener) total += cost(screener, base + IDENTITY_MAX_BYTES, SCREEN_OUTPUT_TOKENS);
  }
  for (const judge of setup.panel) total += cost(judge, base + transcript, JUDGE_OUTPUT_TOKENS);
  for (const voter of aiVoters) {
    total += cost(voter, base, STANCE_OUTPUT_TOKENS);
    total += cost(voter, base + transcript, STANCE_OUTPUT_TOKENS);
  }
  return Math.ceil(total);
}
