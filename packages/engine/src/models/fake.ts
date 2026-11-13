import { countWords } from '../turns/words';
import type { ModelClient, ModelRequest, ModelResponse } from './client';

export type FakeReply = string | { text: string; finishReason: 'stop' | 'length' };

/** Deterministic offline model for local dev and tests. Token counts are word counts. */
export class FakeModelClient implements ModelClient {
  readonly calls: ModelRequest[] = [];

  constructor(private readonly respond: (request: ModelRequest) => FakeReply = r => `Fake reply from ${r.model}.`) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    const reply = this.respond(request);
    const { text, finishReason } = typeof reply === 'string' ? { text: reply, finishReason: 'stop' as const } : reply;
    return {
      text,
      inputTokens: countWords(request.messages.map(m => m.content).join('\n')),
      outputTokens: countWords(text),
      finishReason,
    };
  }
}
