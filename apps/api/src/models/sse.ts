/**
 * The `data:` payloads of a Server-Sent Events body, in order, up to `[DONE]`. Comment lines (OpenRouter sends
 * `: OPENROUTER PROCESSING` to keep the connection open) and blank lines are skipped. Lines and multi-byte
 * characters split across network reads are joined first.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // The last piece may be half a line; keep it for the next read, unless the body has ended.
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') return;
        yield data;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
