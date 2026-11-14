import { utf8Length, type ModelClient, type ModelId, type ModelRequest, type ModelResponse } from '@debate-arena/engine';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
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

  async complete(request: ModelRequest): Promise<ModelResponse> {
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
      }),
    });

    const body = (await response.json().catch(() => ({}))) as CompletionBody;
    if (!response.ok) {
      throw new OpenRouterError(`OpenRouter ${response.status}: ${describeError(body.error, 'request failed')}`, response.status);
    }
    return readCompletion(body, request, response.status);
  }
}

/** A chat completion body as a ModelResponse; shared by live calls and Batch API results. */
export function readCompletion(body: CompletionBody, request: ModelRequest, status: number | null): ModelResponse {
  const choice = body.choices?.[0];
  if (!choice) throw new OpenRouterError(`OpenRouter returned no choices for ${request.model}`, status);
  if (choice.finish_reason === 'error') throw new OpenRouterError(`OpenRouter reported an error for ${request.model}`, status);

  // Without usage, charge the worst case (prompt bytes bound its tokens; output is at most max_tokens),
  // so a missing field can never make a call free and slip past Budget enforcement.
  return {
    text: choice.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens ?? utf8Length(request.messages.map(m => m.content).join('')),
    outputTokens: body.usage?.completion_tokens ?? request.maxOutputTokens,
    finishReason: choice.finish_reason === 'length' ? 'length' : 'stop',
  };
}
