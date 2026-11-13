import { countWords } from '../turns/words';
import type { ModelClient, ModelRequest, ModelResponse } from './client';

/** Deterministic offline model for local dev and tests. Token counts are word counts. */
export class FakeModelClient implements ModelClient {
  readonly calls: ModelRequest[] = [];

  constructor(private readonly respond: (request: ModelRequest) => string = r => `Fake reply from ${r.model}.`) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    const text = this.respond(request);
    return {
      text,
      inputTokens: countWords(request.messages.map(m => m.content).join('\n')),
      outputTokens: countWords(text),
    };
  }
}
