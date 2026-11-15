import { expect, test } from 'vitest';
import { sseData } from '../src/models/sse';

/** A response body that arrives in the given pieces, as a network read would split it. */
export function body(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function all(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of sseData(stream)) out.push(data);
  return out;
}

test('yields data payloads, joining a line split across reads', async () => {
  expect(await all(body('data: {"a"', ':1}\n\n', 'data: {"b":2}\n\ndata: [DONE]\n\n'))).toEqual(['{"a":1}', '{"b":2}']);
});

test('skips comments and blank lines, and stops at [DONE]', async () => {
  expect(await all(body(': OPENROUTER PROCESSING\n\n', '\n', 'data: {"a":1}\n\n', 'data: [DONE]\n\n', 'data: {"late":1}\n\n'))).toEqual(['{"a":1}']);
});

test('decodes a multi-byte character split across reads', async () => {
  const bytes = new TextEncoder().encode('data: {"t":"é"}\n\n');
  const split = bytes.indexOf(0xa9); // the second byte of "é"
  expect(await all(body(bytes.slice(0, split), bytes.slice(split)))).toEqual(['{"t":"é"}']);
});

test('a last line without a trailing newline still counts', async () => {
  expect(await all(body('data: {"a":1}'))).toEqual(['{"a":1}']);
});
