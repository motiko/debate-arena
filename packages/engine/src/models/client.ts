import type { ModelId } from '../domain';

export interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ModelRequest { model: ModelId; messages: ModelMessage[]; maxOutputTokens: number }
export interface ModelResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** 'length' when the provider stopped at maxOutputTokens. */
  finishReason?: 'stop' | 'length';
}

export interface CompleteOptions {
  /** Called with the whole reply so far as it is written. Clients that cannot stream (a Batch API) never call it. */
  onText?: (textSoFar: string) => void;
}

/** The engine's only way to reach a model. Hosting layers provide real implementations (e.g. OpenRouter). */
export interface ModelClient { complete(request: ModelRequest, options?: CompleteOptions): Promise<ModelResponse> }
