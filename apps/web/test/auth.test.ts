import { expect, test } from 'vitest';
import { deleteAccount, signInWithGithub, signOut } from '../src/lib/auth';

function recorder(response: Response) {
  const seen: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(new URL(String(input), 'https://x.test'), init));
    return response;
  }) as typeof fetch;
  return { fetcher, seen };
}

test('signInWithGithub posts JSON and returns the GitHub URL', async () => {
  const { fetcher, seen } = recorder(Response.json({ url: 'https://github.com/login/oauth/authorize?x', redirect: true }));
  expect(await signInWithGithub('/debates/d1', fetcher)).toBe('https://github.com/login/oauth/authorize?x');
  expect(seen[0]?.method).toBe('POST');
  expect(new URL(seen[0]!.url).pathname).toBe('/api/auth/sign-in/social');
  expect(seen[0]?.headers.get('content-type')).toBe('application/json');
  expect(await seen[0]?.json()).toEqual({ provider: 'github', callbackURL: '/debates/d1' });
});

test('signInWithGithub fails loudly without a URL', async () => {
  const { fetcher } = recorder(Response.json({ message: 'nope' }, { status: 500 }));
  await expect(signInWithGithub('/', fetcher)).rejects.toThrow();
});

test('signOut posts to the sign-out endpoint', async () => {
  const { fetcher, seen } = recorder(Response.json({ success: true }));
  await signOut(fetcher);
  expect(new URL(seen[0]!.url).pathname).toBe('/api/auth/sign-out');
  expect(seen[0]?.method).toBe('POST');
});

test('deleteAccount succeeds', async () => {
  const { fetcher, seen } = recorder(Response.json({ success: true, message: 'User deleted' }));
  expect(await deleteAccount(fetcher)).toEqual({ ok: true });
  expect(new URL(seen[0]!.url).pathname).toBe('/api/auth/delete-user');
});

test('deleteAccount reports SESSION_EXPIRED', async () => {
  const { fetcher } = recorder(Response.json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, { status: 400 }));
  expect(await deleteAccount(fetcher)).toEqual({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' });
});
