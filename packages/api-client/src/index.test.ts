import { expect, test } from 'vitest';
import { createApiClient } from './index';

test('builds typed request URLs', () => {
  const client = createApiClient('https://api.test');
  expect(client.debates[':id'].$url({ param: { id: 'd1' } }).toString()).toBe('https://api.test/debates/d1');
  expect(client.debates[':id'].live.$url({ param: { id: 'd1' } }).toString()).toBe('https://api.test/debates/d1/live');
});

test('sends custom headers and the JSON body', async () => {
  const seen: { url: string; headers: Headers; body: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: request.headers, body: await request.text() });
    return Response.json({ id: 'd1', panel: ['c/j'], selfJudging: false }, { status: 201 });
  }) as typeof fetch;
  const client = createApiClient('https://api.test', { fetch: fetcher, headers: { 'x-dev-member': 'm1' } });
  const res = await client.debates.$post({
    json: { motion: 'Cats beat dogs', debaters: { for: 'a/x', against: 'b/y' }, aiVoters: false },
  });
  expect(res.status).toBe(201);
  expect(seen[0]?.url).toBe('https://api.test/debates');
  expect(seen[0]?.headers.get('x-dev-member')).toBe('m1');
  expect(JSON.parse(seen[0]!.body)).toMatchObject({ motion: 'Cats beat dogs' });
});
