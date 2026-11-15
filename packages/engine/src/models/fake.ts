import { countWords } from '../turns/words';
import type { CompleteOptions, ModelClient, ModelRequest, ModelResponse } from './client';

export type FakeReply = string | { text: string; finishReason: 'stop' | 'length' };

/** Deterministic offline model for local dev and tests. Token counts are word counts. */
export class FakeModelClient implements ModelClient {
  readonly calls: ModelRequest[] = [];

  constructor(private readonly respond: (request: ModelRequest) => FakeReply = r => `Fake reply from ${r.model}.`) {}

  async complete(request: ModelRequest, options?: CompleteOptions): Promise<ModelResponse> {
    this.calls.push(request);
    const reply = this.respond(request);
    const { text, finishReason } = typeof reply === 'string' ? { text: reply, finishReason: 'stop' as const } : reply;
    if (options?.onText) for (const prefix of wordPrefixes(text)) await this.beforeWord(text, prefix, options.onText);
    return {
      text,
      inputTokens: countWords(request.messages.map(m => m.content).join('\n')),
      outputTokens: countWords(text),
      finishReason,
    };
  }

  /** Hands one streamed prefix on; a subclass can wait first, to pace the stream like a real model. */
  protected async beforeWord(_text: string, prefix: string, onText: (textSoFar: string) => void): Promise<void> {
    onText(prefix);
  }
}

/** The reply up to the end of each word, in order: "One", "One two", "One two three." (spacing kept). */
function wordPrefixes(text: string): string[] {
  return [...text.matchAll(/\S+/g)].map(m => text.slice(0, m.index + m[0].length));
}
