import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { getAuth } from '../src/auth/auth';
import { appendTurn, getDebate } from '../src/db/debates';
import { authPostHeaders, createApiToken, linkGithub, signedInHeaders } from './auth-helpers';
import { turnAt } from './helpers';

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

test("a token's expiry cannot be removed or changed after creation", async () => {
  const { userId, headers } = await signedInHeaders();
  const { id } = await createApiToken(headers);
  const res = await exports.default.fetch(`${base}/auth/api-key/update`, {
    method: 'POST',
    headers: authPostHeaders(headers),
    body: JSON.stringify({ keyId: id, expiresIn: null }),
  });
  expect(res.status).toBe(404);
  const row = await env.DB.prepare('SELECT "expiresAt" FROM apikey WHERE "referenceId" = ?').bind(userId).first<{ expiresAt: string | null }>();
  expect(row?.expiresAt).not.toBeNull();
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

const setup = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' } };
const bearer = (key: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${key}`, ...extra });
const json = { 'content-type': 'application/json' };

function startWith(headers: HeadersInit) {
  return exports.default.fetch(`${base}/debates`, { method: 'POST', headers, body: JSON.stringify(setup) });
}

async function tokenFor(name = 'Test Member') {
  const member = await signedInHeaders(name);
  const { id, key } = await createApiToken(member.headers);
  return { ...member, tokenId: id, key };
}

test('a token starts a Debate as its Member', async () => {
  const { userId, key } = await tokenFor();
  const res = await startWith(bearer(key, json));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  expect((await getDebate(env.DB, id))?.memberId).toBe(userId);
});

test("GET /me with a token returns the Member's real name and Quota", async () => {
  const { userId, headers, key } = await tokenFor('Ada Lovelace');
  const res = await exports.default.fetch(`${base}/me`, { headers: bearer(key) });
  expect(res.status).toBe(200);
  const viaSession = (await (await exports.default.fetch(`${base}/me`, { headers })).json()) as { quotaRemaining: number };
  expect(await res.json()).toMatchObject({ id: userId, name: 'Ada Lovelace', quotaRemaining: viaSession.quotaRemaining });
});

test('a session wins over a token', async () => {
  const a = await signedInHeaders();
  const b = await tokenFor();
  const headers = new Headers(a.headers);
  headers.set('authorization', `Bearer ${b.key}`);
  headers.set('content-type', 'application/json');
  const { id } = (await (await startWith(headers)).json()) as { id: string };
  expect((await getDebate(env.DB, id))?.memberId).toBe(a.userId);
});

test('bad tokens are 401', async () => {
  const revoked = await tokenFor();
  await exports.default.fetch(`${base}/auth/api-key/delete`, {
    method: 'POST',
    headers: authPostHeaders(revoked.headers),
    body: JSON.stringify({ keyId: revoked.tokenId }),
  });
  const expired = await tokenFor();
  await env.DB.prepare('UPDATE apikey SET "expiresAt" = ? WHERE id = ?').bind(new Date(Date.now() - DAY_MS).toISOString(), expired.tokenId).run();
  for (const authorization of ['Bearer ', 'Bearer da_garbage', `Bearer ${revoked.key}`, `Bearer ${expired.key}`, 'Basic xyz']) {
    const res = await startWith({ authorization, ...json });
    expect(res.status, authorization.slice(0, 12)).toBe(401);
    expect(await res.json()).toHaveProperty('error');
  }
});

test('a token cannot vote, report, moderate, export or manage tokens', async () => {
  const { userId, key } = await tokenFor();
  await linkGithub(userId, '1');
  const { id } = (await (await startWith(bearer(key, json))).json()) as { id: string };

  const vote = await exports.default.fetch(`${base}/debates/${id}/votes`, {
    method: 'POST',
    headers: bearer(key, json),
    body: JSON.stringify({ phase: 'before', stance: 'for' }),
  });
  expect(vote.status).toBe(401);
  for (const path of ['/moderation/queue', '/me/export', '/auth/api-key/list']) {
    expect((await exports.default.fetch(`${base}${path}`, { headers: bearer(key) })).status, path).toBe(401);
  }
  const report = await exports.default.fetch(`${base}/debates/${id}/reports`, {
    method: 'POST',
    headers: bearer(key, json),
    body: JSON.stringify({ reason: 'hate', explanation: 'It attacks a group of people.', goodFaith: true }),
  });
  expect(report.status).toBe(201);
  const row = await env.DB.prepare('SELECT reporter_member_id FROM reports WHERE debate_id = ?').bind(id).first<{ reporter_member_id: string | null }>();
  expect(row?.reporter_member_id).toBeNull();
});

test('GET /debates/:id with a token reads as a signed-out Viewer', async () => {
  const { key } = await tokenFor();
  const { id } = (await (await startWith(bearer(key, json))).json()) as { id: string };
  await appendTurn(env.DB, id, 0, turnAt(0));
  const view = (await (await exports.default.fetch(`${base}/debates/${id}`, { headers: bearer(key) })).json()) as { turns: unknown[]; turnsHidden: boolean };
  expect(view.turnsHidden).toBe(false);
  expect(view.turns).toHaveLength(1);
});
