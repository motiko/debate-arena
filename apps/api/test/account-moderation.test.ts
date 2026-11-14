import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { completeDebate, createDebate } from '../src/db/debates';
import { memberReportsSince, recordDecision } from '../src/db/moderation';
import { linkGithub, signedInHeaders } from './auth-helpers';
import { newDebate } from './helpers';

const base = 'https://api.test/api';
const json = (headers: Headers) => {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  return h;
};

async function completed(memberId = 'someone') {
  const d = newDebate({ memberId });
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, new Date().toISOString());
  return d.id;
}

async function reportAs(headers: Headers, id: string) {
  const res = await exports.default.fetch(`${base}/debates/${id}/reports`, {
    method: 'POST',
    headers: json(headers),
    body: JSON.stringify({ reason: 'hate', explanation: 'It attacks a group of people.', goodFaith: true }),
  });
  expect(res.status).toBe(201);
}

const blockDecision = (debateId: string, moderatorId: string) => ({
  id: crypto.randomUUID(),
  debateId,
  action: 'block' as const,
  source: 'reports' as const,
  automatedDetection: false,
  ground: 'terms' as const,
  groundRef: 'Terms §3 Hate',
  explanation: 'The Motion attacks a group of people.',
  moderatorId,
  decidedAt: '2026-11-14T10:00:00.000Z',
});

test('the export includes Reports, decisions and the Blocked statement of reasons', async () => {
  const { userId, headers } = await signedInHeaders('Ada');
  const reported = await completed();
  await reportAs(headers, reported);
  const own = await completed(userId);
  await recordDecision(env.DB, blockDecision(own, 'mod-x'));
  const decided = await completed();
  await recordDecision(env.DB, blockDecision(decided, userId));

  const data = (await (await exports.default.fetch(`${base}/me/export`, { headers })).json()) as {
    debates: { id: string; visibility: string; blocked?: unknown }[];
    reports: unknown[];
    moderationDecisions: unknown[];
  };
  expect(data.reports).toEqual([{ debateId: reported, reason: 'hate', explanation: 'It attacks a group of people.', createdAt: expect.any(String) }]);
  expect(data.debates.find(d => d.id === own)).toMatchObject({
    visibility: 'blocked',
    blocked: { ground: 'terms', groundRef: 'Terms §3 Hate', explanation: 'The Motion attacks a group of people.', decidedAt: '2026-11-14T10:00:00.000Z' },
  });
  expect(data.moderationDecisions).toEqual([
    { debateId: decided, action: 'block', ground: 'terms', groundRef: 'Terms §3 Hate', explanation: 'The Motion attacks a group of people.', decidedAt: '2026-11-14T10:00:00.000Z' },
  ]);
});

test('deletion unlinks Reports and decisions per row, and Reports still count', async () => {
  const { userId, headers } = await signedInHeaders();
  await linkGithub(userId, `gh-${userId}`);
  const [a, b] = [await completed(), await completed()];
  await reportAs(headers, a);
  await reportAs(headers, b);
  await recordDecision(env.DB, blockDecision(await completed(), userId));

  const del = json(headers);
  del.set('origin', 'http://localhost:8787');
  expect((await exports.default.fetch(`${base}/auth/delete-user`, { method: 'POST', headers: del, body: '{}' })).status).toBe(200);

  const count = async (sql: string) => (await env.DB.prepare(sql).bind(userId).first<{ n: number }>())!.n;
  expect(await count('SELECT COUNT(*) AS n FROM reports WHERE reporter_member_id = ?')).toBe(0);
  expect(await count('SELECT COUNT(*) AS n FROM moderation_decisions WHERE moderator_id = ?')).toBe(0);
  const { results } = await env.DB.prepare('SELECT reporter_member_id AS r FROM reports WHERE debate_id IN (?, ?)').bind(a, b).all<{ r: string }>();
  expect(new Set(results.map(row => row.r)).size).toBe(2);
  expect(await memberReportsSince(env.DB, a, null)).toBe(1);
});
