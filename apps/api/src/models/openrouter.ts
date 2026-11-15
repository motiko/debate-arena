import { utf8Length, type CompleteOptions, type ModelClient, type ModelId, type ModelRequest, type ModelResponse } from '@debate-arena/engine';
import { sseData } from './sse';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Tokens a failed call must still be charged for. */
export interface Charge {
  inputTokens: number;
  outputTokens: number;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Set when the provider already produced (and billed) output before the call failed: a stream cut partway. */
    readonly charge?: Charge,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export interface OpenRouterOptions {
  fetcher?: typeof fetch;
  /** Whether to send `reasoning: { enabled: false }` for a model; true for catalog models with optional reasoning. */
  disableReasoning?: (model: ModelId) => boolean;
}

/** OpenRouter's error; a provider's own error sits in metadata.raw (often a JSON string) behind a generic message. */
export interface OpenRouterErrorBody {
  message?: string;
  metadata?: { raw?: unknown; provider_name?: string };
}

export interface CompletionBody {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: OpenRouterErrorBody;
}

/** OpenRouter's error message, followed by the provider's own message when there is one. */
export function describeError(error: OpenRouterErrorBody | undefined, fallback: string): string {
  const message = error?.message ?? fallback;
  let raw = error?.metadata?.raw;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      // Not JSON: keep the text.
    }
  }
  const detail = typeof raw === 'string' ? raw : (raw as { message?: unknown } | undefined)?.message;
  if (typeof detail !== 'string' || !detail.trim()) return message;
  const provider = error?.metadata?.provider_name;
  return `${message} (${provider ? `${provider}: ` : ''}${detail.trim().slice(0, 300)})`;
}

export class OpenRouterModelClient implements ModelClient {
  private readonly fetcher: typeof fetch;
  private readonly disableReasoning: (model: ModelId) => boolean;

  constructor(
    private readonly apiKey: string,
    options: OpenRouterOptions = {},
  ) {
    // Wrapped so the global fetch is never called detached from its receiver.
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.disableReasoning = options.disableReasoning ?? (() => false);
  }

  async complete(request: ModelRequest, options: CompleteOptions = {}): Promise<ModelResponse> {
    const { onText } = options;
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/motiko/debate-arena',
        'X-OpenRouter-Title': 'Debate Arena',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        ...(this.disableReasoning(request.model) ? { reasoning: { enabled: false } } : {}),
        // Only a caller that shows the reply as it is written asks for a stream.
        ...(onText ? { stream: true } : {}),
      }),
    });

    if (!response.ok || !onText) {
      const body = (await response.json().catch(() => ({}))) as CompletionBody;
      if (!response.ok) {
        throw new OpenRouterError(`OpenRouter ${response.status}: ${describeError(body.error, 'request failed')}`, response.status);
      }
      return readCompletion(body, request, response.status);
    }
    return readStream(response, request, onText);
  }
}

/** One Server-Sent Event of a streamed chat completion. */
interface StreamChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: CompletionBody['usage'];
  error?: OpenRouterErrorBody & { code?: number };
}

/**
 * A streamed chat completion, reporting the text so far after each piece. Only `delta.content` is text:
 * reasoning arrives in other fields and is never shown. Once the stream has started, an error comes as a chunk
 * with a top-level `error` (the status stays 200), possibly as the only chunk.
 */
async function readStream(response: Response, request: ModelRequest, onText: (textSoFar: string) => void): Promise<ModelResponse> {
  if (!response.body) throw new OpenRouterError(`OpenRouter returned no stream for ${request.model}`, response.status);
  let text = '';
  let finishReason: string | null = null;
  let usage: CompletionBody['usage'];
  for await (const data of sseData(response.body)) {
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      continue;
    }
    const choice = chunk.choices?.[0];
    if (chunk.usage) usage = chunk.usage;
    if (chunk.error || choice?.finish_reason === 'error') {
      // The stream had started, so the provider may have billed output already: the failure is charged too.
      throw new OpenRouterError(`OpenRouter: ${describeError(chunk.error, `stream failed for ${request.model}`)}`, chunk.error?.code ?? null, charged(usage, request));
    }
    const piece = choice?.delta?.content;
    if (piece) {
      text += piece;
      onText(text);
    }
    // The finish reason repeats on the closing accounting chunk, which also carries the usage.
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  // A body that just stops, with no finish reason, was cut off: keeping its text would store half a speech as
  // a finished Turn. Failing lets the step try again; what was already produced is charged.
  if (finishReason === null) {
    throw new OpenRouterError(`OpenRouter's stream for ${request.model} ended before the reply did`, null, charged(usage, request));
  }
  return toResponse(text, finishReason, usage, request);
}

/** What a call costs in tokens: as reported, or the worst case (see toResponse). */
function charged(usage: CompletionBody['usage'], request: ModelRequest): Charge {
  const { inputTokens, outputTokens } = toResponse('', null, usage, request);
  return { inputTokens, outputTokens };
}

/** A chat completion body as a ModelResponse; shared by live calls and Batch API results. */
export function readCompletion(body: CompletionBody, request: ModelRequest, status: number | null): ModelResponse {
  const choice = body.choices?.[0];
  if (!choice) throw new OpenRouterError(`OpenRouter returned no choices for ${request.model}`, status);
  if (choice.finish_reason === 'error') throw new OpenRouterError(`OpenRouter reported an error for ${request.model}`, status);
  return toResponse(choice.message?.content ?? '', choice.finish_reason ?? null, body.usage, request);
}

function toResponse(text: string, finishReason: string | null, usage: CompletionBody['usage'], request: ModelRequest): ModelResponse {
  // Without usage, charge the worst case (prompt bytes bound its tokens; output is at most max_tokens),
  // so a missing field can never make a call free and slip past Budget enforcement.
  return {
    text,
    inputTokens: usage?.prompt_tokens ?? utf8Length(request.messages.map(m => m.content).join('')),
    outputTokens: usage?.completion_tokens ?? request.maxOutputTokens,
    finishReason: finishReason === 'length' ? 'length' : 'stop',
  };
}
