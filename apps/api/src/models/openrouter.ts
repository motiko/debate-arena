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

interface CompletionBody {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
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
      throw new OpenRouterError(`OpenRouter ${response.status}: ${body.error?.message ?? 'request failed'}`, response.status);
    }
    const choice = body.choices?.[0];
    if (!choice) throw new OpenRouterError(`OpenRouter returned no choices for ${request.model}`, response.status);
    if (choice.finish_reason === 'error') throw new OpenRouterError(`OpenRouter reported an error for ${request.model}`, response.status);

    // Without usage, charge the worst case (prompt bytes bound its tokens; output is at most max_tokens),
    // so a missing field can never make a call free and slip past Budget enforcement.
    return {
      text: choice.message?.content ?? '',
      inputTokens: body.usage?.prompt_tokens ?? utf8Length(request.messages.map(m => m.content).join('')),
      outputTokens: body.usage?.completion_tokens ?? request.maxOutputTokens,
      finishReason: choice.finish_reason === 'length' ? 'length' : 'stop',
    };
  }
}
