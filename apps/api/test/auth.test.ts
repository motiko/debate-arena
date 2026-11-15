import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { makeAuth } from '../src/auth/auth';
import { DAILY_QUOTA_POINTS, spendQuota } from '../src/db/quota';
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
  expect(await res.json()).toEqual({ id: userId, name: 'Ada', image: null, quotaRemaining: 24, isModerator: false });
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
  expect(await res.json()).toEqual({ id: 'dev-7', name: 'dev-7', image: null, quotaRemaining: 24, isModerator: false });
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

/** A signed-in Member whose GitHub account id is in UNLIMITED_QUOTA_GITHUB_IDS ('3' in tests), with today's Quota spent. */
async function unlimitedMemberWithQuotaSpent(): Promise<{ userId: string; headers: Headers }> {
  const member = await signedInHeaders('Una Limited');
  await linkGithub(member.userId, '3');
  expect(await spendQuota(env.DB, member.userId, DAILY_QUOTA_POINTS, new Date())).toBe(true);
  return member;
}

test('GET /api/me reports a full Quota for a Member with unlimited Quota', async () => {
  const { headers } = await unlimitedMemberWithQuotaSpent();
  const res = await exports.default.fetch('https://api.test/api/me', { headers });
  expect(await res.json()).toMatchObject({ quotaRemaining: DAILY_QUOTA_POINTS });
});

test('a Member with unlimited Quota starts a Debate after their daily points are spent', async () => {
  const { headers } = await unlimitedMemberWithQuotaSpent();
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  const body = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false };
  const res = await exports.default.fetch('https://api.test/api/debates', { method: 'POST', headers: h, body: JSON.stringify(body) });
  expect(res.status).toBe(201);
});
