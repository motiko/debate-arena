import { expect, test } from 'vitest';
import { getMe, serverApi } from '../src/lib/server-api';

function fakeBinding(respond: (request: Request) => Response) {
  const seen: Request[] = [];
  const api = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push(request);
      return respond(request);
    },
  };
  return { api: api as unknown as Fetcher, seen };
}

test("forwards the Viewer's cookie and dev member header to the API", async () => {
  const { api, seen } = fakeBinding(() => Response.json({ id: 'm1', name: 'Ada', image: null, quotaRemaining: 6 }));
  const incoming = new Request('https://x.test/debates/d1', {
    headers: { cookie: 'better-auth.session_token=s', 'x-dev-member': 'dev-1', 'x-forwarded-host': 'evil.test', 'user-agent': 'UA' },
  });
  const me = await getMe(serverApi(incoming, api));
  expect(me).toEqual({ id: 'm1', name: 'Ada', image: null, quotaRemaining: 6 });
  expect(seen[0]?.url).toBe('https://x.test/api/me');
  expect(seen[0]?.headers.get('cookie')).toBe('better-auth.session_token=s');
  expect(seen[0]?.headers.get('x-dev-member')).toBe('dev-1');
  expect(seen[0]?.headers.get('x-forwarded-host')).toBeNull();
});

test('sends no identity headers the Viewer did not send', async () => {
  const { api, seen } = fakeBinding(() => Response.json({ error: 'Not signed in' }, { status: 401 }));
  await getMe(serverApi(new Request('https://x.test/'), api));
  expect(seen[0]?.headers.has('cookie')).toBe(false);
  expect(seen[0]?.headers.has('x-dev-member')).toBe(false);
});

test('getMe returns null when signed out', async () => {
  const { api } = fakeBinding(() => Response.json({ error: 'Not signed in' }, { status: 401 }));
  expect(await getMe(serverApi(new Request('https://x.test/'), api))).toBeNull();
});
