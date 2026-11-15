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

test("keeps the provider's own error behind OpenRouter's generic one", async () => {
  // As OpenRouter answered for mistralai/mistral-large-4-0 with reasoning disabled (2026-11-14).
  const raw = '{"object":"error","message":"reasoning_effort none is not supported for this model"}';
  const { fetcher } = stub(400, { error: { message: 'Provider returned error', metadata: { raw, provider_name: 'Mistral' } } });
  await expect(new OpenRouterModelClient('k', { fetcher }).complete(req)).rejects.toThrow(
    'OpenRouter 400: Provider returned error (Mistral: reasoning_effort none is not supported for this model)',
  );
});

/** An SSE reply: each chunk as a `data:` event, then [DONE]. Comments are passed through as they are. */
function streamStub(events: (object | string)[]) {
  const sent: Sent[] = [];
  const text = events.map(e => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`)).join('') + 'data: [DONE]\n\n';
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { sent, fetcher };
}
const delta = (d: object, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

test('streams: reports cumulative text, returns the whole reply with usage and finish reason', async () => {
  const { sent, fetcher } = streamStub([
    ': OPENROUTER PROCESSING\n\n',
    delta({ role: 'assistant', content: '' }),
    delta({ content: 'Hello' }),
    delta({ reasoning: 'thinking about it' }),
    delta({ content: ' world' }),
    delta({ content: '' }, 'length'),
    { ...delta({ content: '' }, 'length'), usage: { prompt_tokens: 12, completion_tokens: 2 } },
  ]);
  const seen: string[] = [];
  const reply = await new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: t => seen.push(t) });
  expect(seen).toEqual(['Hello', 'Hello world']);
  expect(reply).toEqual({ text: 'Hello world', inputTokens: 12, outputTokens: 2, finishReason: 'length' });
  expect(JSON.parse(sent[0]!.body)).toMatchObject({ model: 'a/x', max_tokens: 10, stream: true });
});

test('a mid-stream error chunk throws OpenRouterError with its message', async () => {
  const { fetcher } = streamStub([
    delta({ content: 'Half a' }),
    { error: { code: 502, message: 'Provider disconnected unexpectedly' }, ...delta({ content: '' }, 'error') },
  ]);
  const failure = new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: () => {} });
  await expect(failure).rejects.toBeInstanceOf(OpenRouterError);
  await expect(failure).rejects.toThrow('Provider disconnected unexpectedly');
});

test('an error as the first and only chunk is a failure, not an empty reply', async () => {
  const { fetcher } = streamStub([{ error: { code: 502, message: 'No provider' }, ...delta({ content: '' }, 'error') }]);
  await expect(new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: () => {} })).rejects.toBeInstanceOf(OpenRouterError);
});

test('a stream that ends without a finish reason is a failure, not a finished reply', async () => {
  // The body closes after some text, with no finish chunk: a cut connection, not the end of the speech.
  const { fetcher } = streamStub([delta({ content: 'And therefore the' })]);
  await expect(new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: () => {} })).rejects.toBeInstanceOf(OpenRouterError);
});

test('a stream that fails partway carries its worst-case cost, since the provider billed what it sent', async () => {
  const cut = streamStub([delta({ content: 'And therefore the' })]);
  const cutError = await new OpenRouterModelClient('k', { fetcher: cut.fetcher }).complete(req, { onText: () => {} }).catch(e => e);
  expect(cutError).toBeInstanceOf(OpenRouterError);
  expect(cutError.charge).toEqual({ inputTokens: expect.any(Number), outputTokens: req.maxOutputTokens });
  expect(cutError.charge.inputTokens).toBeGreaterThan(0);

  const failed = streamStub([delta({ content: 'Half a' }), { error: { code: 502, message: 'Provider disconnected' }, ...delta({ content: '' }, 'error') }]);
  const failedError = await new OpenRouterModelClient('k', { fetcher: failed.fetcher }).complete(req, { onText: () => {} }).catch(e => e);
  expect(failedError.charge).toMatchObject({ outputTokens: req.maxOutputTokens });
});

test('an error before the stream starts carries no charge', async () => {
  const { fetcher } = stub(429, { error: { message: 'Rate limited' } });
  const error = await new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: () => {} }).catch(e => e);
  expect(error.charge).toBeUndefined();
});

test('a stream without usage is charged the worst case', async () => {
  const { fetcher } = streamStub([delta({ content: 'Hi' }, 'stop')]);
  const reply = await new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: () => {} });
  expect(reply.outputTokens).toBe(req.maxOutputTokens);
  expect(reply.inputTokens).toBeGreaterThan(0);
  expect(reply.finishReason).toBe('stop');
});

test('a non-2xx reply to a stream request throws as today', async () => {
  const { fetcher } = stub(429, { error: { message: 'Rate limited' } });
  const failure = new OpenRouterModelClient('k', { fetcher }).complete(req, { onText: () => {} });
  await expect(failure).rejects.toMatchObject({ name: 'OpenRouterError', status: 429 });
});

test('without onText, sends no stream key', async () => {
  const { sent, fetcher } = stub(200, ok);
  await new OpenRouterModelClient('k', { fetcher }).complete(req);
  expect(JSON.parse(sent[0]!.body)).not.toHaveProperty('stream');
});
