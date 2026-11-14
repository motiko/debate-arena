import {
  FakeModelClient,
  JUDGE_OUTPUT_TOKENS,
  SCREEN_OUTPUT_TOKENS,
  STANCE_OUTPUT_TOKENS,
  type ModelClient,
  type ModelRequest,
  type PriceTable,
} from '@debate-arena/engine';
import { FAKE_CATALOG, PRODUCTION_CATALOG, type Catalog } from './catalog';
import { FakeBatchApi, OpenRouterBatchApi, type BatchApi } from './batch';
import { OpenRouterModelClient } from './openrouter';

export interface Models { client: ModelClient; catalog: Catalog }

export interface ModelEnv { MODEL_PROVIDER: 'fake' | 'openrouter'; OPENROUTER_API_KEY?: string }

/** Offline replies shaped like real ones, so local Debates run to completion. */
export function devFakeReply(request: ModelRequest): string {
  const seed = request.model.length + request.messages.length;
  if (request.maxOutputTokens === SCREEN_OUTPUT_TOKENS) {
    // `[flag-test]` in a Motion makes the fake screener Flag it, to try moderation locally.
    return request.messages.some(m => m.content.includes('[flag-test]')) ? 'unsafe\nS10' : 'safe';
  }
  if (request.maxOutputTokens === JUDGE_OUTPUT_TOKENS) {
    return JSON.stringify({ winner: seed % 2 === 0 ? 'for' : 'against', reasoning: 'A fake Verdict for local development.' });
  }
  if (request.maxOutputTokens === STANCE_OUTPUT_TOKENS) {
    const isAfter = request.messages.some(m => m.content.includes('heard the whole debate'));
    return isAfter ? (seed % 2 === 0 ? 'for' : 'against') : 'undecided';
  }
  return `A fake argument from ${request.model}, written for local development.`;
}

/** How long the `fake-slow/` Debater takes per reply, so a local Debate can be watched while live. */
export const SLOW_FAKE_DELAY_MS = 1500;

class DevFakeModelClient extends FakeModelClient {
  override async complete(request: ModelRequest) {
    if (request.model.startsWith('fake-slow/')) await new Promise(resolve => setTimeout(resolve, SLOW_FAKE_DELAY_MS));
    return super.complete(request);
  }
}

export function createModels(env: ModelEnv): Models {
  if (env.MODEL_PROVIDER === 'fake') return { client: new DevFakeModelClient(devFakeReply), catalog: FAKE_CATALOG };
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  const catalog = PRODUCTION_CATALOG;
  const client = new OpenRouterModelClient(env.OPENROUTER_API_KEY, {
    disableReasoning: id => catalog.entries.some(e => e.id === id && e.reasoning === 'optional'),
  });
  return { client, catalog };
}

/** The Batch API for Batch Debates: OpenRouter's, or an offline fake that answers after FAKE_BATCH_DELAY_MS. */
export function createBatchApi(env: ModelEnv): BatchApi {
  if (env.MODEL_PROVIDER === 'fake') return new FakeBatchApi(devFakeReply);
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  return new OpenRouterBatchApi(env.OPENROUTER_API_KEY, {
    disableReasoning: id => PRODUCTION_CATALOG.entries.some(e => e.id === id && e.reasoning === 'optional'),
  });
}

/** Thrown when a Debate has spent its reserved Budget; not worth retrying. */
export class BudgetExhaustedError extends Error {
  override name = 'BudgetExhaustedError';
}

/**
 * Wraps a client so each successful call reports its cost in micro-USD (tokens × price per million tokens).
 * `guard` runs before every call and throws (e.g. BudgetExhaustedError) to stop spending.
 */
export function meteredClient(
  client: ModelClient,
  prices: PriceTable,
  onCost: (microUsd: number) => Promise<void>,
  guard: () => Promise<void> = async () => {},
): ModelClient {
  return {
    async complete(request) {
      await guard();
      const response = await client.complete(request);
      const price = Object.hasOwn(prices, request.model) ? prices[request.model] : undefined;
      if (price) {
        await onCost(Math.ceil(response.inputTokens * price.inputPerMTokUsd + response.outputTokens * price.outputPerMTokUsd));
      }
      return response;
    },
  };
}
