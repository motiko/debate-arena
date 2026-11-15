import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { getAuth } from '../src/auth/auth';
import { authPostHeaders, createApiToken, signedInHeaders } from './auth-helpers';

const base = 'https://api.test/api';
const DAY_MS = 86_400_000;

const verify = (key: string) => getAuth(env).api.verifyApiKey({ body: { key } });

test('a Member creates a token and sees it once', async () => {
  const { headers } = await signedInHeaders();
  const { id, key } = await createApiToken(headers, { name: 'Laptop' });
  expect(key).toMatch(/^da_/);
  const list = (await (await exports.default.fetch(`${base}/auth/api-key/list`, { headers })).json()) as unknown;
  const keys = (Array.isArray(list) ? list : (list as { apiKeys: unknown[] }).apiKeys) as Record<string, unknown>[];
  const listed = keys.find(k => k.id === id);
  expect(listed).toMatchObject({ name: 'Laptop' });
  expect(listed).not.toHaveProperty('key');
});

test('tokens expire after 90 days by default', async () => {
  const { headers } = await signedInHeaders();
  const created = (await createApiToken(headers)) as unknown as { expiresAt: string };
  expect(Math.abs(new Date(created.expiresAt).getTime() - (Date.now() + 90 * DAY_MS))).toBeLessThan(60_000);
});

test('expiry outside 1–365 days is refused', async () => {
  const { headers } = await signedInHeaders();
  await expect(createApiToken(headers, { expiresIn: 400 * 86_400 })).rejects.toThrow(/\(400\)/);
});

test('a token name is required and at most 50 characters', async () => {
  const { headers } = await signedInHeaders();
  await expect(createApiToken(headers, { name: '' })).rejects.toThrow(/\(400\)/);
  await expect(createApiToken(headers, { name: 'x'.repeat(51) })).rejects.toThrow(/\(400\)/);
  await expect(createApiToken(headers, { name: 'x'.repeat(50) })).resolves.toHaveProperty('key');
});

test('a token is not limited to 10 uses', async () => {
  const { headers } = await signedInHeaders();
  const { key } = await createApiToken(headers);
  for (let i = 0; i < 12; i++) expect((await verify(key)).valid).toBe(true);
});

test('a revoked token no longer verifies', async () => {
  const { headers } = await signedInHeaders();
  const { id, key } = await createApiToken(headers);
  const res = await exports.default.fetch(`${base}/auth/api-key/delete`, {
    method: 'POST',
    headers: authPostHeaders(headers),
    body: JSON.stringify({ keyId: id }),
  });
  expect(res.status).toBe(200);
  expect((await verify(key)).valid).toBe(false);
});

test('deleting the account deletes its tokens', async () => {
  const { userId, headers } = await signedInHeaders();
  await createApiToken(headers);
  const res = await exports.default.fetch(`${base}/auth/delete-user`, { method: 'POST', headers: authPostHeaders(headers), body: '{}' });
  expect(res.status).toBe(200);
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM apikey WHERE "referenceId" = ?').bind(userId).first<{ n: number }>();
  expect(row?.n).toBe(0);
});
