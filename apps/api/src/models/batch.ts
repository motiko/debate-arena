// OpenRouter's Batch API (about half price; results in minutes to hours). A Batch Debate sends each model call as
// a one-request batch and polls for its result; the engine never waits inside a Worker request.
import type { ModelId, ModelRequest, ModelResponse } from '@debate-arena/engine';
import { OpenRouterError, readCompletion, type CompletionBody } from './openrouter';

const BATCHES = 'https://openrouter.ai/api/v1/batches';

/** How long the fake Batch API takes to answer, so local Batch Debates behave like slow real ones. */
export const FAKE_BATCH_DELAY_MS = 2000;

export type BatchStatus =
  | { status: 'pending' }
  | { status: 'completed'; response: ModelResponse }
  | { status: 'failed'; reason: string };

export interface BatchApi {
  /** Submits one model call as a batch; returns the batch id. */
  submit(request: ModelRequest): Promise<string>;
  /** `request` is the call that was submitted; it bounds usage when a result omits it. */
  get(id: string, request: ModelRequest): Promise<BatchStatus>;
}

/** Thrown when a batch call has been submitted but its result is not ready yet. Not a failure: wait and run again. */
export class BatchPendingError extends Error {
  override name = 'BatchPendingError';
}

const PENDING = new Set(['validating', 'in_progress', 'finalizing']);

interface BatchBody {
  id?: string;
  status?: string;
  results?: { custom_id?: string; response?: CompletionBody; error?: { message?: string } }[];
  error?: { message?: string };
}

export class OpenRouterBatchApi implements BatchApi {
  private readonly fetcher: typeof fetch;
  private readonly disableReasoning: (model: ModelId) => boolean;

  constructor(
    private readonly apiKey: string,
    options: { fetcher?: typeof fetch; disableReasoning?: (model: ModelId) => boolean } = {},
  ) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.disableReasoning = options.disableReasoning ?? (() => false);
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/motiko/debate-arena',
      'X-OpenRouter-Title': 'Debate Arena',
    };
  }

  async submit(request: ModelRequest): Promise<string> {
    const response = await this.fetcher(BATCHES, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        endpoint: '/v1/chat/completions',
        model: request.model,
        completion_window: '24h',
        requests: [
          {
            custom_id: 'call',
            body: {
              model: request.model,
              messages: request.messages,
              max_tokens: request.maxOutputTokens,
              ...(this.disableReasoning(request.model) ? { reasoning: { enabled: false } } : {}),
            },
          },
        ],
      }),
    });
    const body = (await response.json().catch(() => ({}))) as BatchBody;
    if (!response.ok || !body.id) {
      throw new OpenRouterError(`OpenRouter batch ${response.status}: ${body.error?.message ?? 'submission failed'}`, response.status);
    }
    return body.id;
  }

  async get(id: string, request: ModelRequest): Promise<BatchStatus> {
    const response = await this.fetcher(`${BATCHES}/${encodeURIComponent(id)}`, { headers: this.headers() });
    const body = (await response.json().catch(() => ({}))) as BatchBody;
    if (!response.ok) {
      throw new OpenRouterError(`OpenRouter batch ${response.status}: ${body.error?.message ?? 'lookup failed'}`, response.status);
    }
    if (body.status && PENDING.has(body.status)) return { status: 'pending' };
    if (body.status !== 'completed') return { status: 'failed', reason: `Batch ${body.status ?? 'unknown'}` };
    const result = body.results?.find(r => r.custom_id === 'call') ?? body.results?.[0];
    if (!result?.response) return { status: 'failed', reason: result?.error?.message ?? 'Batch completed without a result' };
    try {
      return { status: 'completed', response: readCompletion(result.response, request, response.status) };
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * Offline stand-in (MODEL_PROVIDER "fake"): answers each call after `delayMs`. Stateless across Worker requests:
 * the batch id itself carries when the answer is ready.
 */
export class FakeBatchApi implements BatchApi {
  constructor(
    private readonly reply: (request: ModelRequest) => string,
    private readonly delayMs = FAKE_BATCH_DELAY_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async submit(_request: ModelRequest): Promise<string> {
    return `fake:${this.now() + this.delayMs}:${crypto.randomUUID()}`;
  }

  async get(id: string, request: ModelRequest): Promise<BatchStatus> {
    const [prefix, readyAt] = id.split(':');
    if (prefix !== 'fake' || !readyAt) return { status: 'failed', reason: 'Unknown fake batch' };
    if (this.now() < Number(readyAt)) return { status: 'pending' };
    const text = this.reply(request);
    return {
      status: 'completed',
      response: { text, inputTokens: request.messages.reduce((n, m) => n + m.content.length, 0), outputTokens: text.length, finishReason: 'stop' },
    };
  }
}
