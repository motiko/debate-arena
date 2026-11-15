import {
  FakeModelClient,
  JUDGE_OUTPUT_TOKENS,
  SCREEN_OUTPUT_TOKENS,
  STANCE_OUTPUT_TOKENS,
  type CompleteOptions,
  type ModelClient,
  type ModelRequest,
  type PriceTable,
} from '@debate-arena/engine';
import { FAKE_CATALOG, PRODUCTION_CATALOG, type Catalog } from './catalog';
import { FakeBatchApi, OpenRouterBatchApi, type BatchApi } from './batch';
import { OpenRouterError, OpenRouterModelClient } from './openrouter';

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

/** The `fake-slow/` Debater's speech: long enough to watch it stream on a local live Debate. */
const SLOW_FAKE_SPEECH =
  'Madam Chair, this is a fake speech for local development. It is long enough to watch it being written, word by word, ' +
  'the way a real model streams its Turn. First, a point. Second, a rebuttal. Finally, a closing line that ends the speech.';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The local fake models. The `fake-slow/` Debater takes SLOW_FAKE_DELAY_MS per reply: all at once, or, when the
 * reply is streamed, spread over its words, so a local live Debate shows a speech growing.
 */
class DevFakeModelClient extends FakeModelClient {
  constructor() {
    super(request => (request.model.startsWith('fake-slow/') ? SLOW_FAKE_SPEECH : devFakeReply(request)));
  }

  override async complete(request: ModelRequest, options?: CompleteOptions) {
    if (request.model.startsWith('fake-slow/') && !options?.onText) await sleep(SLOW_FAKE_DELAY_MS);
    return super.complete(request, options);
  }

  protected override async beforeWord(text: string, prefix: string, onText: (textSoFar: string) => void) {
    if (text === SLOW_FAKE_SPEECH) await sleep(SLOW_FAKE_DELAY_MS / text.split(/\s+/).length);
    onText(prefix);
  }
}

export function createModels(env: ModelEnv): Models {
  if (env.MODEL_PROVIDER === 'fake') return { client: new DevFakeModelClient(), catalog: FAKE_CATALOG };
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  const catalog = PRODUCTION_CATALOG;
  const client = new OpenRouterModelClient(env.OPENROUTER_API_KEY, {
    disableReasoning: id => catalog.entries.some(e => e.id === id && e.reasoning === 'optional'),
  });
  return { client, catalog };
}

/** The Batch API for Batch Debates: OpenRouter's, or an offline fake that answers after FAKE_BATCH_DELAY_MS. */
export function createBatchApi(env: ModelEnv & { BETTER_AUTH_URL?: string; OPENROUTER_WEBHOOK_SECRET?: string }): BatchApi {
  if (env.MODEL_PROVIDER === 'fake') return new FakeBatchApi(devFakeReply);
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  // OpenRouter calls back only to a public HTTPS address, and we only accept signed calls: both must be set.
  const callback = env.OPENROUTER_WEBHOOK_SECRET && env.BETTER_AUTH_URL?.startsWith('https://');
  return new OpenRouterBatchApi(env.OPENROUTER_API_KEY, {
    disableReasoning: id => PRODUCTION_CATALOG.entries.some(e => e.id === id && e.reasoning === 'optional'),
    ...(callback ? { callbackUrl: `${env.BETTER_AUTH_URL!.replace(/\/$/, '')}/api/webhooks/openrouter` } : {}),
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
    async complete(request, options) {
      await guard();
      const price = Object.hasOwn(prices, request.model) ? prices[request.model] : undefined;
      const charge = async (tokens: { inputTokens: number; outputTokens: number }) => {
        if (price) await onCost(Math.ceil(tokens.inputTokens * price.inputPerMTokUsd + tokens.outputTokens * price.outputPerMTokUsd));
      };
      let response;
      try {
        response = await client.complete(request, options);
      } catch (error) {
        // A stream cut partway was already billed by the provider: it counts against the Budget, so a failure
        // is never free (and a Debate that spent money is not refunded).
        if (error instanceof OpenRouterError && error.charge) await charge(error.charge);
        throw error;
      }
      await charge(response);
      return response;
    },
  };
}
