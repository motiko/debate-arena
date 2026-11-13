import type { ModelRequest } from '@debate-arena/engine';
import { expect, test } from 'vitest';
import { OpenRouterError, OpenRouterModelClient } from '../src/models/openrouter';

interface Sent { url: string; headers: Headers; body: string }

function stub(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetcher };
}

const req: ModelRequest = { model: 'a/x', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 };
const ok = { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } };

test('sends the model, messages, token cap and disabled reasoning', async () => {
  const { sent, fetcher } = stub(200, ok);
  await new OpenRouterModelClient('test-key', { fetcher, disableReasoning: () => true }).complete(req);
  expect(sent[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(sent[0]?.headers.get('authorization')).toBe('Bearer test-key');
  expect(sent[0]?.headers.get('x-openrouter-title')).toBe('Debate Arena');
  expect(JSON.parse(sent[0]!.body)).toEqual({
    model: 'a/x',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 10,
    reasoning: { enabled: false },
  });
});

test('omits the reasoning setting for models that do not reason', async () => {
  const { sent, fetcher } = stub(200, ok);
  await new OpenRouterModelClient('k', { fetcher, disableReasoning: () => false }).complete(req);
  expect(JSON.parse(sent[0]!.body)).not.toHaveProperty('reasoning');
});

test('maps text, usage and a length stop', async () => {
  const { fetcher } = stub(200, { ...ok, choices: [{ message: { content: 'Hello' }, finish_reason: 'length' }] });
  expect(await new OpenRouterModelClient('k', { fetcher }).complete(req)).toEqual({
    text: 'Hello',
    inputTokens: 12,
    outputTokens: 3,
    finishReason: 'length',
  });
});

test('null content becomes empty text, and missing usage is charged at its worst case', async () => {
  const { fetcher } = stub(200, { choices: [{ message: { content: null }, finish_reason: 'stop' }] });
  expect(await new OpenRouterModelClient('k', { fetcher }).complete(req)).toEqual({
    text: '',
    inputTokens: 2, // UTF-8 bytes of the prompt ("hi"), an upper bound on its tokens
    outputTokens: 10, // the full max_tokens
    finishReason: 'stop',
  });
});

test.each([
  [500, { error: { message: 'boom' } }],
  [200, {}],
  [200, { choices: [{ message: { content: 'x' }, finish_reason: 'error' }] }],
])('status %i with %j throws OpenRouterError', async (status, body) => {
  const { fetcher } = stub(status, body);
  await expect(new OpenRouterModelClient('k', { fetcher }).complete(req)).rejects.toBeInstanceOf(OpenRouterError);
});
