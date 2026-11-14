import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { completeDebate, createDebate, getDebate } from '../src/db/debates';
import { recordDecision } from '../src/db/moderation';
import { newDebate, uniqueId } from './helpers';

const base = 'https://api.test/api';
const valid = { reason: 'hate', explanation: 'It attacks a group of people.', goodFaith: true };

async function debate() {
  const d = newDebate();
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, new Date().toISOString());
  return d.id;
}

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

function report(id: string, body: unknown, headers: Record<string, string> = {}) {
  return exports.default.fetch(`${base}/debates/${id}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshIp(), ...headers },
    body: JSON.stringify(body),
  });
}

const asMember = (member = uniqueId('m')) => ({ 'x-dev-member': member });
const visibility = async (id: string) => (await getDebate(env.DB, id))?.visibility;

test('a Member reports once', async () => {
  const id = await debate();
  const member = asMember();
  expect((await report(id, valid, member)).status).toBe(201);
  const second = await report(id, valid, member);
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: 'You already reported this Debate' });
});

test('five Members Unlist a Debate', async () => {
  const id = await debate();
  for (let i = 0; i < 4; i++) expect((await report(id, valid, asMember())).status).toBe(201);
  expect(await visibility(id)).toBe('listed');
  await report(id, valid, asMember());
  expect(await visibility(id)).toBe('unlisted');
});

test('anonymous Reports do not Unlist', async () => {
  const id = await debate();
  for (let i = 0; i < 6; i++) {
    const res = await report(id, { ...valid, name: 'A Viewer', email: 'viewer@example.test' });
    expect(res.status).toBe(201);
  }
  expect(await visibility(id)).toBe('listed');
});

test('reports are rate limited per IP', async () => {
  const id = await debate();
  const ip = { 'cf-connecting-ip': '198.51.100.7' };
  for (let i = 0; i < 10; i++) expect((await report(id, valid, ip)).status).toBe(201);
  const res = await report(id, valid, ip);
  expect(res.status).toBe(429);
});

test('IPv6 addresses in one /64 share a limit', async () => {
  const id = await debate();
  for (let i = 1; i <= 10; i++) expect((await report(id, valid, { 'cf-connecting-ip': `2001:db8:1:2::${i.toString(16)}` })).status).toBe(201);
  expect((await report(id, valid, { 'cf-connecting-ip': '2001:db8:1:2:ffff:ffff:ffff:ffff' })).status).toBe(429);
  expect((await report(id, valid, { 'cf-connecting-ip': '2001:db8:1:3::1' })).status).toBe(201);
});

test('parallel Reports cannot exceed the limit', async () => {
  const id = await debate();
  const ip = { 'cf-connecting-ip': '198.51.100.42' };
  const statuses = await Promise.all(Array.from({ length: 15 }, () => report(id, valid, ip).then(r => r.status)));
  expect(statuses.filter(s => s === 201)).toHaveLength(10);
  expect(statuses.filter(s => s === 429)).toHaveLength(5);
});

test('IP hashes are kept only as long as rate limiting needs them', async () => {
  const id = await debate();
  await env.DB.prepare(
    `INSERT INTO reports (id, debate_id, reason, explanation, ip_hash, created_at) VALUES (?, ?, 'hate', 'An old Report here.', 'old-hash', ?)`,
  )
    .bind(crypto.randomUUID(), id, new Date(Date.now() - 2 * 3600_000).toISOString())
    .run();
  await report(id, valid);
  const old = await env.DB.prepare(`SELECT ip_hash FROM reports WHERE explanation = 'An old Report here.' AND debate_id = ?`)
    .bind(id)
    .first<{ ip_hash: string | null }>();
  expect(old?.ip_hash).toBeNull();
});

test('the threshold restarts after a review', async () => {
  const id = await debate();
  for (let i = 0; i < 4; i++) await report(id, valid, asMember());
  await recordDecision(env.DB, {
    id: crypto.randomUUID(),
    debateId: id,
    action: 'relist',
    source: 'reports',
    automatedDetection: false,
    ground: null,
    groundRef: null,
    explanation: null,
    moderatorId: 'mod-1',
    // 1 ms after the last Report: a Report in the same millisecond as a review counts as after it.
    decidedAt: new Date(Date.now() + 1).toISOString(),
  });
  await report(id, valid, asMember());
  expect(await visibility(id)).toBe('listed');
});

test.each([
  [{ ...valid, goodFaith: false }, /good faith/i],
  [{ ...valid, explanation: 'short' }, /explanation/i],
  [{ ...valid, reason: 'boring' }, /reason/i],
  [{ ...valid, email: 'not-an-email' }, /email/i],
])('a Report needs a reason, an explanation and the good-faith confirmation (%#)', async (body, message) => {
  const id = await debate();
  const res = await report(id, body);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toMatch(message);
});

test('Reports on unknown or Blocked Debates are refused', async () => {
  expect((await report('nope', valid)).status).toBe(404);
  const id = await debate();
  await recordDecision(env.DB, {
    id: crypto.randomUUID(),
    debateId: id,
    action: 'block',
    source: 'moderator',
    automatedDetection: false,
    ground: 'terms',
    groundRef: 'Terms §3',
    explanation: 'Hateful Motion.',
    moderatorId: 'mod-1',
    decidedAt: new Date().toISOString(),
  });
  expect((await report(id, valid)).status).toBe(410);
});

test('Reports must be JSON', async () => {
  const id = await debate();
  const res = await exports.default.fetch(`${base}/debates/${id}/reports`, { method: 'POST', body: 'reason=hate' });
  expect(res.status).toBe(415);
});
