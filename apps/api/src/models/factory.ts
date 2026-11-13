import {
  FakeModelClient,
  JUDGE_OUTPUT_TOKENS,
  STANCE_OUTPUT_TOKENS,
  type ModelClient,
  type ModelRequest,
  type PriceTable,
} from '@debate-arena/engine';
import { FAKE_CATALOG, PRODUCTION_CATALOG, type Catalog } from './catalog';
import { OpenRouterModelClient } from './openrouter';

export interface Models { client: ModelClient; catalog: Catalog }

export interface ModelEnv { MODEL_PROVIDER: 'fake' | 'openrouter'; OPENROUTER_API_KEY?: string }

/** Offline replies shaped like real ones, so local Debates run to completion. */
export function devFakeReply(request: ModelRequest): string {
  const seed = request.model.length + request.messages.length;
  if (request.maxOutputTokens === JUDGE_OUTPUT_TOKENS) {
    return JSON.stringify({ winner: seed % 2 === 0 ? 'for' : 'against', reasoning: 'A fake Verdict for local development.' });
  }
  if (request.maxOutputTokens === STANCE_OUTPUT_TOKENS) {
    const isAfter = request.messages.some(m => m.content.includes('heard the whole debate'));
    return isAfter ? (seed % 2 === 0 ? 'for' : 'against') : 'undecided';
  }
  return `A fake argument from ${request.model}, written for local development.`;
}

export function createModels(env: ModelEnv): Models {
  if (env.MODEL_PROVIDER === 'fake') return { client: new FakeModelClient(devFakeReply), catalog: FAKE_CATALOG };
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  const catalog = PRODUCTION_CATALOG;
  const client = new OpenRouterModelClient(env.OPENROUTER_API_KEY, {
    disableReasoning: id => catalog.entries.some(e => e.id === id && e.reasoning === 'optional'),
  });
  return { client, catalog };
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
