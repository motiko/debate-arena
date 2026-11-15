import { expect, test } from 'vitest';
import { createApiClient, matchesSearch, sendDraft, submitTurn } from './index';

test('matchesSearch: every word, in any order, in the label, id or provider, ignoring case', () => {
  const haiku = { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' };
  expect(matchesSearch(haiku, 'haiku', 'Anthropic')).toBe(true);
  expect(matchesSearch(haiku, 'ANTHROPIC  haiku', 'Anthropic')).toBe(true);
  expect(matchesSearch(haiku, 'claude-haiku', 'Anthropic')).toBe(true);
  expect(matchesSearch(haiku, 'haiku openai', 'Anthropic')).toBe(false);
  expect(matchesSearch(haiku, '   ', 'Anthropic')).toBe(true);
});

function recorder(status: number, body: unknown = null) {
  const seen: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return body === null ? new Response(null, { status }) : Response.json(body, { status });
  }) as typeof fetch;
  return { seen, fetcher };
}

test('submitTurn posts the text with the token', async () => {
  const { seen, fetcher } = recorder(201, { slotIndex: 2 });
  const res = await submitTurn('https://api.test', 'da_x', 'd 1', 2, 'My speech.', fetcher);
  expect(res.status).toBe(201);
  expect(seen[0]?.method).toBe('POST');
  expect(seen[0]?.url).toBe('https://api.test/api/debates/d%201/turns/2');
  expect(seen[0]?.headers.get('authorization')).toBe('Bearer da_x');
  expect(seen[0]?.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(await seen[0]?.text()).toBe('My speech.');
});

test('submitTurn sends a Custom Debater identity as query parameters, in any script', async () => {
  const { seen, fetcher } = recorder(201, { slotIndex: 2 });
  await submitTurn('https://api.test', 'da_x', 'd1', 2, 'Hi.', fetcher, { name: 'Zoë' });
  expect(seen[0]?.url).toBe('https://api.test/api/debates/d1/turns/2?name=Zo%C3%AB');
  await submitTurn('https://api.test', 'da_x', 'd1', 2, 'Hi.', fetcher, {});
  expect(seen[1]?.url).toBe('https://api.test/api/debates/d1/turns/2');
});

test('submitTurn drops trailing slashes from the base, quickly even for a base full of slashes', async () => {
  const { seen, fetcher } = recorder(201, { slotIndex: 0 });
  await submitTurn('https://api.test///', 'da_x', 'd1', 0, 'x', fetcher);
  expect(seen[0]?.url).toBe('https://api.test/api/debates/d1/turns/0');
  const hostile = `https://api.test/${'/'.repeat(100_000)}x`;
  const started = performance.now();
  await sendDraft(hostile, 'da_x', 'd1', 0, 'x', recorder(204).fetcher);
  expect(performance.now() - started).toBeLessThan(200);
});

test('submitTurn streams a body', async () => {
  const { seen, fetcher } = recorder(201, { slotIndex: 0 });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('Streamed.'));
      controller.close();
    },
  });
  await submitTurn('https://api.test', 'da_x', 'd1', 0, body, fetcher);
  expect(await seen[0]?.text()).toBe('Streamed.');
});

test('sendDraft puts the text so far', async () => {
  const { seen, fetcher } = recorder(204);
  await sendDraft('https://api.test', 'da_x', 'd1', 0, 'Half a', fetcher);
  expect(seen[0]?.method).toBe('PUT');
  expect(seen[0]?.url).toBe('https://api.test/api/debates/d1/turns/0/draft');
  expect(await seen[0]?.text()).toBe('Half a');
});

test('builds typed request URLs', () => {
  const client = createApiClient('https://api.test');
  expect(client.api.debates[':id'].$url({ param: { id: 'd1' } }).toString()).toBe('https://api.test/api/debates/d1');
  expect(client.api.debates[':id'].live.$url({ param: { id: 'd1' } }).toString()).toBe('https://api.test/api/debates/d1/live');
});

test('sends custom headers and the JSON body', async () => {
  const seen: { url: string; headers: Headers; body: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: request.headers, body: await request.text() });
    return Response.json({ id: 'd1', panel: ['c/j'], selfJudging: false }, { status: 201 });
  }) as typeof fetch;
  const client = createApiClient('https://api.test', { fetch: fetcher, headers: { 'x-dev-member': 'm1' } });
  const res = await client.api.debates.$post({
    json: { motion: 'Cats beat dogs', debaters: { for: 'a/x', against: 'b/y' }, aiVoters: false },
  });
  expect(res.status).toBe(201);
  expect(seen[0]?.url).toBe('https://api.test/api/debates');
  expect(seen[0]?.headers.get('x-dev-member')).toBe('m1');
  expect(JSON.parse(seen[0]!.body)).toMatchObject({ motion: 'Cats beat dogs' });
});
