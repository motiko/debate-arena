import { expect, test } from 'vitest';
import { FakeBatchApi, OpenRouterBatchApi } from '../src/models/batch';

const request = { model: 'anthropic/claude-haiku-5.5', messages: [{ role: 'user' as const, content: 'Argue for.' }], maxOutputTokens: 100 };

function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  }) as typeof fetch;
  return { fetcher, calls };
}

test('OpenRouterBatchApi submits one request with the base model id', async () => {
  const { fetcher, calls } = fakeFetch(() => Response.json({ id: 'batch_1', status: 'validating' }, { status: 202 }));
  const api = new OpenRouterBatchApi('key-1', { fetcher, disableReasoning: () => true });
  expect(await api.submit(request)).toBe('batch_1');
  expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/batches');
  expect(calls[0]?.init?.method).toBe('POST');
  expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer key-1');
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
    endpoint: '/v1/chat/completions',
    model: 'anthropic/claude-haiku-5.5',
    completion_window: '24h',
    requests: [
      {
        custom_id: 'call',
        body: { model: 'anthropic/claude-haiku-5.5', messages: request.messages, max_tokens: 100, reasoning: { enabled: false } },
      },
    ],
  });
});

test('OpenRouterBatchApi fails loudly when a submission is refused', async () => {
  const { fetcher } = fakeFetch(() => Response.json({ error: { message: 'Insufficient credits' } }, { status: 402 }));
  await expect(new OpenRouterBatchApi('k', { fetcher }).submit(request)).rejects.toThrow(/402/);
});

test.each(['validating', 'in_progress', 'finalizing'])('OpenRouterBatchApi keeps waiting while %s', async status => {
  const { fetcher, calls } = fakeFetch(() => Response.json({ id: 'batch_1', status }));
  expect(await new OpenRouterBatchApi('k', { fetcher }).get('batch_1', request)).toEqual({ status: 'pending' });
  expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/batches/batch_1');
});

test('OpenRouterBatchApi reads a completed batch', async () => {
  // OpenRouter wraps each completion as response.body, next to its status_code (seen 2026-11-14).
  const { fetcher } = fakeFetch(() =>
    Response.json({
      id: 'batch_1',
      status: 'completed',
      results: [
        {
          custom_id: 'call',
          response: {
            status_code: 200,
            body: { choices: [{ message: { content: 'My argument.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
          },
          error: null,
        },
      ],
    }),
  );
  expect(await new OpenRouterBatchApi('k', { fetcher }).get('batch_1', request)).toEqual({
    status: 'completed',
    response: { text: 'My argument.', inputTokens: 12, outputTokens: 3, finishReason: 'stop' },
  });
});

test.each([
  [{ status: 'failed' }],
  [{ status: 'expired' }],
  [{ status: 'cancelled' }],
  [{ status: 'completed', results: [{ custom_id: 'call', error: { message: 'Provider error' } }] }],
  [{ status: 'completed', results: [] }],
  [{ status: 'completed', results: [{ custom_id: 'call', response: { status_code: 400, body: { error: { message: 'Bad request' } } } }] }],
])('OpenRouterBatchApi reports a failed batch (%#)', async body => {
  const { fetcher } = fakeFetch(() => Response.json({ id: 'batch_1', ...body }));
  expect(await new OpenRouterBatchApi('k', { fetcher }).get('batch_1', request)).toMatchObject({ status: 'failed' });
});

test('OpenRouterBatchApi keeps the error OpenRouter gives for a failed batch', async () => {
  // As OpenRouter answered for google/gemini-3.8-flash with reasoning disabled (2026-11-14).
  const message = "Failed to lower batch request 'call' to the provider wire: Reasoning is mandatory for this endpoint and cannot be disabled.";
  const { fetcher } = fakeFetch(() => Response.json({ id: 'batch_1', status: 'failed', results: null, error: { message } }));
  expect(await new OpenRouterBatchApi('k', { fetcher }).get('batch_1', request)).toEqual({ status: 'failed', reason: `Batch failed: ${message}` });
});

test('FakeBatchApi answers after its delay', async () => {
  let now = 1_000;
  const api = new FakeBatchApi(r => `Fake answer to ${r.model}`, 2000, () => now);
  const id = await api.submit(request);
  expect(await api.get(id, request)).toEqual({ status: 'pending' });
  now = 3_000;
  expect(await api.get(id, request)).toMatchObject({ status: 'completed', response: { text: 'Fake answer to anthropic/claude-haiku-5.5' } });
});
