import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { makeAuth } from '../src/auth/auth';
import { linkGithub, signedInHeaders } from './auth-helpers';

test('GET /api/me without a session is 401', async () => {
  const res = await exports.default.fetch('https://api.test/api/me');
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Not signed in' });
});

test('GET /api/me with a session returns the Member and their Quota', async () => {
  const { userId, headers } = await signedInHeaders('Ada');
  const res = await exports.default.fetch('https://api.test/api/me', { headers });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: userId, name: 'Ada', image: null, quotaRemaining: 6 });
});

test('GET /api/me passes on a refreshed session cookie, so active Members stay signed in', async () => {
  const { userId, headers } = await signedInHeaders('Ada');
  // A session created two days ago (expiry 7 days after creation): past Better Auth's one-day updateAge.
  const expiresAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
  await env.DB.prepare('UPDATE session SET expiresAt = ? WHERE userId = ?').bind(expiresAt, userId).run();
  const res = await exports.default.fetch('https://api.test/api/me', { headers });
  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie')).toContain('session_token=');
});

test('GET /api/me names a dev Member while DEV_AUTH is on', async () => {
  // vitest.config sets DEV_AUTH "true", as `pnpm dev` does; production config has "false".
  const res = await exports.default.fetch('https://api.test/api/me', { headers: { 'x-dev-member': 'dev-7' } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 'dev-7', name: 'dev-7', image: null, quotaRemaining: 6 });
});

test('the GitHub sign-in route sends the browser to GitHub', async () => {
  const res = await exports.default.fetch('https://api.test/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
    body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
  });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  expect(url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://localhost:8787/api/auth/callback/github');
});

test('GitHub tokens are never stored', async () => {
  const { userId } = await signedInHeaders();
  await linkGithub(userId, `gh-${userId}`, 'gho_secret_token');
  const row = await env.DB.prepare('SELECT "accessToken", "refreshToken", "idToken" FROM account WHERE "userId" = ?').bind(userId).first();
  expect(row).toEqual({ accessToken: null, refreshToken: null, idToken: null });
});

test.each([[''], ['too-short'], ['better-auth-secret-12345678901234567890']])('outside local dev, the secret %j is refused', secret => {
  expect(() => makeAuth({ ...env, DEV_AUTH: 'false', BETTER_AUTH_SECRET: secret })).toThrow(/BETTER_AUTH_SECRET/);
});

test('local dev may run without a secret', () => {
  expect(() => makeAuth({ ...env, DEV_AUTH: 'true', BETTER_AUTH_SECRET: '' })).not.toThrow();
});
