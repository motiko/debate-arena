import { turnSlots, wordsToTokens } from '../debate/schedule';
import type { DebateSetup, ModelId } from '../domain';
import { UnknownModelPriceError } from '../errors';
import { JUDGE_OUTPUT_TOKENS } from '../judging/judge';
import { countWords } from '../turns/words';
import { STANCE_OUTPUT_TOKENS } from '../voting/ai-voter';

export { JUDGE_OUTPUT_TOKENS, STANCE_OUTPUT_TOKENS };

export interface ModelPrice { inputPerMTokUsd: number; outputPerMTokUsd: number }
export type PriceTable = Record<ModelId, ModelPrice>;

export const PROMPT_OVERHEAD_TOKENS = 600;

/**
 * Worst-case AI cost of a Debate in micro-USD, assuming every Turn uses its full word limit.
 * Reserved from the Member's Quota before the Debate starts. Motion screening is added in Plan 5.
 */
export function worstCaseBudgetMicroUsd(setup: DebateSetup, aiVoters: ModelId[], prices: PriceTable): number {
  // tokens × USD per million tokens = micro-USD
  const cost = (model: ModelId, input: number, output: number) => {
    const price = prices[model];
    if (!price) throw new UnknownModelPriceError(`No price for ${model}`);
    return input * price.inputPerMTokUsd + output * price.outputPerMTokUsd;
  };

  const base = PROMPT_OVERHEAD_TOKENS + wordsToTokens(countWords(setup.motion.text));
  let transcript = 0;
  let total = 0;

  for (const slot of turnSlots(setup.format)) {
    const output = wordsToTokens(setup.format.phases[slot.phaseIndex]!.maxWords);
    const debater = setup.debaters[slot.side];
    if (debater.kind === 'ai') total += cost(debater.model, base + transcript, output);
    transcript += output;
  }
  for (const judge of setup.panel) total += cost(judge, base + transcript, JUDGE_OUTPUT_TOKENS);
  for (const voter of aiVoters) {
    total += cost(voter, base, STANCE_OUTPUT_TOKENS);
    total += cost(voter, base + transcript, STANCE_OUTPUT_TOKENS);
  }
  return Math.ceil(total);
}
