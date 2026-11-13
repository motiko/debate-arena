export const ENGINE_VERSION = '0.1.0';

export type * from './domain';
export * from './errors';
export { CLASSIC_FORMAT } from './formats/classic';
export { countWords, truncateToWords } from './turns/words';
export type { ModelClient, ModelMessage, ModelRequest, ModelResponse } from './models/client';
export { FakeModelClient, type FakeReply } from './models/fake';
export {
  MAX_ATTEMPTS,
  nextSlot,
  OUTPUT_HEADROOM,
  TOKENS_PER_WORD,
  turnOutputCap,
  turnSlots,
  wordsToTokens,
} from './debate/schedule';
export { buildTurnMessages, UNTRUSTED_NOTICE } from './debate/prompts';
export { generateTurn } from './debate/generate-turn';
export { isSelfJudging, modelFamily, suggestPanel, validatePanel } from './judging/panel';
export { buildJudgeMessages, judgeDebate, parseVerdict } from './judging/judge';
export { computeOxfordResult, type OxfordResult, type VoterStances } from './voting/oxford';
export { castAiStance, parseStance, runAiAudience } from './voting/ai-voter';
export {
  JUDGE_OUTPUT_TOKENS,
  PROMPT_OVERHEAD_TOKENS,
  STANCE_OUTPUT_TOKENS,
  utf8Length,
  worstCaseBudgetMicroUsd,
  type ModelPrice,
  type PriceTable,
} from './budget/estimate';
