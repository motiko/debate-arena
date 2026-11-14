import { expect, test, vi } from 'vitest';
import { routeRequest } from '../src/route';

function fakeApi() {
  const seen: Request[] = [];
  const api = {
    fetch: vi.fn(async (request: Request) => {
      seen.push(request);
      return new Response('api');
    }),
  };
  return { api: api as unknown as Fetcher, seen };
}

const astro = () => vi.fn(async (_request: Request) => new Response('astro'));

test('forwards /api/* to the API binding untouched', async () => {
  const { api, seen } = fakeApi();
  const render = astro();
  const request = new Request('https://arena.test/api/debates', {
    method: 'POST',
    headers: { cookie: 'session=abc', 'content-type': 'application/json' },
    body: '{}',
  });
  const response = await routeRequest(request, { API: api }, render);
  expect(await response.text()).toBe('api');
  expect(seen[0]).toBe(request);
  expect(seen[0]?.method).toBe('POST');
  expect(seen[0]?.headers.get('cookie')).toBe('session=abc');
  expect(render).not.toHaveBeenCalled();
});

test('forwards WebSocket upgrades to the API', async () => {
  const { api, seen } = fakeApi();
  const request = new Request('https://arena.test/api/debates/d1/live', { headers: { upgrade: 'websocket' } });
  await routeRequest(request, { API: api }, astro());
  expect(seen[0]?.headers.get('upgrade')).toBe('websocket');
});

test.each(['/', '/debates/x', '/apiary', '/new'])('serves %s with Astro', async path => {
  const { api, seen } = fakeApi();
  const render = astro();
  const response = await routeRequest(new Request(`https://arena.test${path}`), { API: api }, render);
  expect(await response.text()).toBe('astro');
  expect(seen).toHaveLength(0);
});

test('forwards bare /api to the API', async () => {
  const { api, seen } = fakeApi();
  await routeRequest(new Request('https://arena.test/api'), { API: api }, astro());
  expect(seen).toHaveLength(1);
});
