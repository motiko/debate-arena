import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { signedInHeaders } from './auth-helpers';

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
