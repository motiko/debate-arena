export const ENGINE_VERSION = '0.1.0';

export type * from './domain';
export * from './errors';
export { CLASSIC_FORMAT } from './formats/classic';
export { countWords, truncateToWords } from './turns/words';
export { dominantScript, type Script } from './turns/script';
export type { CompleteOptions, ModelClient, ModelMessage, ModelRequest, ModelResponse } from './models/client';
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
export {
  identityText,
  MAX_CUSTOM_MODEL_LENGTH,
  MAX_CUSTOM_NAME_LENGTH,
  parseCustomIdentity,
  type CustomIdentity,
} from './debate/custom-identity';
export { generateTurn, isApiSlot, submittedTurn, type GenerateTurnOptions } from './debate/generate-turn';
export { isSelfJudging, modelFamily, suggestPanel, validatePanel } from './judging/panel';
export { buildJudgeMessages, judgeDebate, parseVerdict } from './judging/judge';
export { computeOxfordResult, type OxfordResult, type VoterStances } from './voting/oxford';
export { castAiStance, parseStance, runAiAudience, type AiAudienceResult, type AiVote } from './voting/ai-voter';
export {
  buildScreenMessages,
  FLAG_CATEGORIES,
  parseScreen,
  screenMotion,
  SCREEN_OUTPUT_TOKENS,
  type ScreenedText,
  type ScreenResult,
} from './moderation/screen';
export {
  buildLabelMessages,
  CATEGORIES,
  isCategory,
  labelMotion,
  LABEL_OUTPUT_TOKENS,
  MAX_TAGS,
  normaliseTag,
  parseLabels,
  type Category,
  type Labels,
} from './labels/label';
export {
  JUDGE_OUTPUT_TOKENS,
  PROMPT_OVERHEAD_TOKENS,
  API_TURN_BYTES_PER_WORD,
  apiTurnMaxBytes,
  QUOTA_POINT_MICRO_USD,
  quotaPointsFor,
  STANCE_OUTPUT_TOKENS,
  utf8Length,
  worstCaseBudgetMicroUsd,
  type ModelPrice,
  type PriceTable,
} from './budget/estimate';
