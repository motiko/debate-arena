import {
  CLASSIC_FORMAT,
  FakeModelClient,
  CATEGORIES,
  JUDGE_OUTPUT_TOKENS,
  LABEL_OUTPUT_TOKENS,
  SCREEN_OUTPUT_TOKENS,
  STANCE_OUTPUT_TOKENS,
  type CompleteOptions,
  type ModelClient,
  type ModelId,
  type ModelRequest,
  type PriceTable,
} from '@debate-arena/engine';
import { FAKE_CATALOG, PRODUCTION_CATALOG, reasoningOf, type Catalog, type ReasoningMode } from './catalog';
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
  if (request.maxOutputTokens === LABEL_OUTPUT_TOKENS) {
    // Spread over the Categories by the Motion's length, so a local feed has something to filter.
    const motion = request.messages.at(-1)?.content ?? '';
    // `[label-fail-test]` in a Motion makes the fake labeller answer nonsense, to try a failed labelling.
    if (motion.includes('[label-fail-test]')) return 'I would rather not.';
    return JSON.stringify({ category: CATEGORIES[motion.length % CATEGORIES.length], tags: ['local dev', 'fake'] });
  }
  if (request.maxOutputTokens === JUDGE_OUTPUT_TOKENS) {
    // A Rubric Score for every criterion: For 7, 6, 6, 8 and Against 6, 7, 7, 7 in Rubric order.
    const marks = [[7, 6], [6, 7], [6, 7], [8, 7]];
    const scores = Object.fromEntries(CLASSIC_FORMAT.rubric.criteria.map((c, i) => [c.name, { for: marks[i % 4]![0], against: marks[i % 4]![1] }]));
    const claims = [{ side: 'for', claim: 'A fake claim, made for local development.', status: 'disputed', note: 'A fake check.' }];
    const crux = 'Whether a fake argument can settle a real question.';
    return JSON.stringify({ scores, claims, crux, winner: seed % 2 === 0 ? 'for' : 'against', confidence: 'likely', reasoning: 'A fake Verdict for local development.' });
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

/**
 * The `fake-stream/` Debater's speech: a real Turn's length and shape (paragraphs, emphasis), longer than the
 * Closing limit, so a local Debate shows how a real one streams, folds and is cut off.
 */
export const STREAM_FAKE_SPEECH = [
  'Madam Chair, members of the house: this is a fake speech, written so you can watch a Turn arrive the way a real ' +
    'model sends one. It comes in uneven pieces, a few words at a time, with the *occasional* pause while the model thinks.',
  'My first point is simple. A debate is read as it is written, and a reader should never have to chase the text ' +
    'down the page. **Steady words beat sudden paragraphs**, every time, because the eye can follow a pen but not a ' +
    'landslide.',
  'My second point answers the other side. They will say speed is all that matters, that the sooner the words are ' +
    'on the page the better. But a page that lurches is a page that is skimmed, and a skimmed argument is a lost one.',
  'And so, in closing, I ask the house to judge this motion on the evidence of its own eyes. Watch the words arrive, ' +
    'notice whether they flow or stumble, and vote for the side that let you read in peace. I commend the motion.',
].join('\n\n');

/** The fake-stream Debater's pace: about a real model's 40 words a second, in bursts, with a pause now and then. */
export function streamFakePause(wordIndex: number): number {
  if (wordIndex % 37 === 36) return 700; // the model thinks
  if (wordIndex % 5 !== 4) return 0; // words arrive together, in network-sized pieces
  return 90 + ((wordIndex * 53) % 70); // and the pieces are not evenly spaced
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The local fake models. The `fake-slow/` Debater takes SLOW_FAKE_DELAY_MS per reply: all at once, or, when the
 * reply is streamed, spread over its words, so a local live Debate shows a speech growing. The `fake-stream/`
 * Debater streams a full-length speech at a real model's uneven pace.
 */
class DevFakeModelClient extends FakeModelClient {
  constructor() {
    super(request =>
      request.model.startsWith('fake-slow/') ? SLOW_FAKE_SPEECH : request.model.startsWith('fake-stream/') ? STREAM_FAKE_SPEECH : devFakeReply(request),
    );
  }

  override async complete(request: ModelRequest, options?: CompleteOptions) {
    if (request.model.startsWith('fake-slow/') && !options?.onText) await sleep(SLOW_FAKE_DELAY_MS);
    return super.complete(request, options);
  }

  protected override async beforeWord(text: string, prefix: string, onText: (textSoFar: string) => void) {
    if (text === SLOW_FAKE_SPEECH) await sleep(SLOW_FAKE_DELAY_MS / text.split(/\s+/).length);
    if (text === STREAM_FAKE_SPEECH) {
      const pause = streamFakePause(prefix.split(/\s+/).length - 1);
      if (pause > 0) await sleep(pause);
    }
    onText(prefix);
  }
}

/**
 * The models for a catalog (OpenRouter's, built by loadModels; the curated one by default). The client treats each
 * model's reasoning as `reasoning` says, else as the catalog does: a Debate passes its frozen snapshot.
 */
export function createModels(env: ModelEnv, catalog: Catalog = PRODUCTION_CATALOG, reasoning = reasoningOf(catalog)): Models {
  if (env.MODEL_PROVIDER === 'fake') return { client: new DevFakeModelClient(), catalog: FAKE_CATALOG };
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  return { client: new OpenRouterModelClient(env.OPENROUTER_API_KEY, { reasoning }), catalog };
}

/** The Batch API for Batch Debates: OpenRouter's, or an offline fake that answers after FAKE_BATCH_DELAY_MS. */
export function createBatchApi(
  env: ModelEnv & { BETTER_AUTH_URL?: string; OPENROUTER_WEBHOOK_SECRET?: string },
  reasoning: (id: ModelId) => ReasoningMode = reasoningOf(PRODUCTION_CATALOG),
): BatchApi {
  if (env.MODEL_PROVIDER === 'fake') return new FakeBatchApi(devFakeReply);
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required when MODEL_PROVIDER is openrouter');
  // OpenRouter calls back only to a public HTTPS address, and we only accept signed calls: both must be set.
  const callback = env.OPENROUTER_WEBHOOK_SECRET && env.BETTER_AUTH_URL?.startsWith('https://');
  return new OpenRouterBatchApi(env.OPENROUTER_API_KEY, {
    reasoning,
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
