import { expect, test } from 'vitest';
import { createToken, listTokens, revokeToken } from '../src/lib/tokens';

function recorder(response: Response) {
  const seen: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(new URL(String(input), 'https://x.test'), init));
    return response;
  }) as typeof fetch;
  return { fetcher, seen };
}

const row = { id: 't1', name: 'Laptop', start: 'da_abc', createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2027-02-13T10:00:00.000Z', lastRequest: null };

test('listTokens reads the list endpoint', async () => {
  const { fetcher, seen } = recorder(Response.json({ apiKeys: [{ ...row, enabled: true }], total: 1 }));
  expect(await listTokens(fetcher)).toEqual([row]);
  expect(new URL(seen[0]!.url).pathname).toBe('/api/auth/api-key/list');
  expect(seen[0]?.method).toBe('GET');
});

test('createToken posts the name and expiry in seconds, and returns the key once', async () => {
  const { fetcher, seen } = recorder(Response.json({ ...row, key: 'da_secret' }));
  expect(await createToken('Laptop', 30, fetcher)).toEqual({ token: row, key: 'da_secret' });
  expect(new URL(seen[0]!.url).pathname).toBe('/api/auth/api-key/create');
  expect(seen[0]?.method).toBe('POST');
  expect(seen[0]?.headers.get('content-type')).toBe('application/json');
  expect(await seen[0]?.json()).toEqual({ name: 'Laptop', expiresIn: 30 * 86_400 });
});

test('revokeToken posts the key id', async () => {
  const { fetcher, seen } = recorder(Response.json({ success: true }));
  await revokeToken('t1', fetcher);
  expect(new URL(seen[0]!.url).pathname).toBe('/api/auth/api-key/delete');
  expect(await seen[0]?.json()).toEqual({ keyId: 't1' });
});

test("a failed request throws the API's message", async () => {
  const { fetcher } = recorder(Response.json({ code: 'INVALID_NAME_LENGTH', message: 'Invalid name length' }, { status: 400 }));
  await expect(createToken('', 90, fetcher)).rejects.toThrow('Invalid name length');
});
