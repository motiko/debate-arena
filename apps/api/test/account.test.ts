import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, completeDebate, saveVerdict } from '../src/db/debates';
import { linkGithub, signedInHeaders } from './auth-helpers';
import { turnAt } from './helpers';

const base = 'https://api.test/api';

async function startAndVote(headers: Headers) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  const res = await exports.default.fetch(`${base}/debates`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ motion: 'Cats beat dogs', debaters: { for: 'fake-a/one', against: 'fake-b/one' } }),
  });
  const { id } = (await res.json()) as { id: string };
  for (let i = 0; i < 6; i++) await appendTurn(env.DB, id, i, turnAt(i));
  await saveVerdict(env.DB, id, { winner: 'for', reasoning: 'r', judges: ['fake-c/one'] });
  await completeDebate(env.DB, id, null, new Date().toISOString());
  for (const phase of ['before', 'after']) {
    await exports.default.fetch(`${base}/debates/${id}/votes`, { method: 'POST', headers: h, body: JSON.stringify({ phase, stance: 'for' }) });
  }
  return id;
}

const count = async (sql: string, ...binds: unknown[]) =>
  (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

test('export returns the Member, their Debates and votes', async () => {
  const { userId, headers } = await signedInHeaders('Grace');
  const id = await startAndVote(headers);
  const res = await exports.default.fetch(`${base}/me/export`, { headers });
  expect(res.status).toBe(200);
  const data = (await res.json()) as {
    member: { id: string; name: string; email: string };
    debates: { id: string; motion: string }[];
    votes: { debateId: string; before: string; after: string }[];
  };
  expect(data.member).toMatchObject({ id: userId, name: 'Grace' });
  expect(data.member.email).toMatch(/@example\.test$/);
  expect(data.debates).toEqual([expect.objectContaining({ id, motion: 'Cats beat dogs' })]);
  expect(data.votes).toEqual([{ debateId: id, before: 'for', after: 'for' }]);
});

test('export includes sessions, linked accounts and Quota usage, without secrets', async () => {
  const { userId, headers } = await signedInHeaders();
  await linkGithub(userId, `gh-${userId}`);
  await startAndVote(headers);
  const data = (await (await exports.default.fetch(`${base}/me/export`, { headers })).json()) as Record<string, unknown[]>;
  expect(data.sessions?.length).toBeGreaterThan(0);
  expect(data.sessions?.[0]).toHaveProperty('ipAddress');
  expect(data.sessions?.[0]).not.toHaveProperty('token');
  expect(data.accounts).toEqual([expect.objectContaining({ provider: 'github', accountId: `gh-${userId}` })]);
  expect(JSON.stringify(data.accounts)).not.toMatch(/accessToken|gho_/);
  expect(data.quota).toEqual([expect.objectContaining({ points: 2 })]);
});

test('export without a session is 401', async () => {
  expect((await exports.default.fetch(`${base}/me/export`)).status).toBe(401);
});

test('deleting an account removes the user and unlinks their data, keeping results', async () => {
  const { userId, headers } = await signedInHeaders();
  const id = await startAndVote(headers);
  const before = ((await (await exports.default.fetch(`${base}/debates/${id}`)).json()) as { audienceResult: { counted: number } })
    .audienceResult.counted;

  const del = new Headers(headers);
  del.set('content-type', 'application/json');
  del.set('origin', 'http://localhost:8787');
  const res = await exports.default.fetch(`${base}/auth/delete-user`, { method: 'POST', headers: del, body: '{}' });
  expect(res.status).toBe(200);

  for (const table of ['"user"', 'session', 'account']) {
    const column = table === '"user"' ? 'id' : '"userId"';
    expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, userId)).toBe(0);
  }
  for (const table of ['debates', 'audience_votes', 'quota_usage']) {
    expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id = ?`, userId)).toBe(0);
  }
  const after = (await (await exports.default.fetch(`${base}/debates/${id}`)).json()) as { audienceResult: { counted: number } };
  expect(after.audienceResult.counted).toBe(before);
});
