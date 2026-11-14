import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { completeDebate, createDebate, getDebate, listCompletedDebates } from '../src/db/debates';
import { saveScreen } from '../src/db/moderation';
import { linkGithub, signedInHeaders } from './auth-helpers';
import { newDebate, sampleSetup, uniqueId } from './helpers';

const base = 'https://api.test/api';

/** A signed-in Member whose GitHub account id is in MODERATOR_GITHUB_IDS ('1, 2' in tests). */
async function moderator(): Promise<Headers> {
  const { userId, headers } = await signedInHeaders('Mo Derator');
  await linkGithub(userId, '2');
  return headers;
}

async function completed(motion = `Motion ${uniqueId('t')}`) {
  const d = newDebate({ setup: { ...sampleSetup, motion: { text: motion } } });
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, new Date().toISOString());
  return d.id;
}

async function flagged(motion?: string) {
  const id = await completed(motion);
  await saveScreen(env.DB, id, { flagged: true, categories: ['S10'] }, new Date().toISOString());
  return id;
}

const queue = (headers: HeadersInit = {}) => exports.default.fetch(`${base}/moderation/queue`, { headers });

function decide(id: string, body: unknown, headers: Headers) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  return exports.default.fetch(`${base}/moderation/debates/${id}/decision`, { method: 'POST', headers: h, body: JSON.stringify(body) });
}

const block = { action: 'block', ground: 'terms', groundRef: 'Terms §3 Hate', explanation: 'The Motion attacks a group of people.' };

test('only Moderators see the queue', async () => {
  expect((await queue()).status).toBe(401);
  const { userId, headers } = await signedInHeaders('Not A Moderator');
  await linkGithub(userId, '999');
  expect((await queue(headers)).status).toBe(403);
  expect((await queue(await moderator())).status).toBe(200);
});

test('/api/me says who is a Moderator', async () => {
  const me = async (headers: HeadersInit) => ((await (await exports.default.fetch(`${base}/me`, { headers })).json()) as { isModerator: boolean }).isModerator;
  expect(await me(await moderator())).toBe(true);
  expect(await me((await signedInHeaders()).headers)).toBe(false);
});

test('a local dev-mod Member is a Moderator while DEV_AUTH is on', async () => {
  expect((await queue({ 'x-dev-member': 'dev-mod-1' })).status).toBe(200);
  expect((await queue({ 'x-dev-member': 'dev-1' })).status).toBe(403);
});

test('the queue lists flagged and reported Debates with Report details', async () => {
  const flaggedId = await flagged();
  const reportedId = await completed();
  await exports.default.fetch(`${base}/debates/${reportedId}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.44' },
    body: JSON.stringify({ reason: 'harassment', explanation: 'It targets a named person.', name: 'Rae', email: 'rae@example.test', goodFaith: true }),
  });
  const quiet = await completed();
  const { items } = (await (await queue(await moderator())).json()) as {
    items: { id: string; flagged: boolean; screen: unknown; anonymousReports: number; memberReports: number; reports: unknown[] }[];
  };
  const ids = items.map(i => i.id);
  expect(ids).toContain(flaggedId);
  expect(ids).toContain(reportedId);
  expect(ids).not.toContain(quiet);
  expect(items.find(i => i.id === flaggedId)).toMatchObject({ flagged: true, screen: { categories: ['S10'] } });
  expect(items.find(i => i.id === reportedId)).toMatchObject({
    anonymousReports: 1,
    memberReports: 0,
    reports: [{ reason: 'harassment', explanation: 'It targets a named person.', reporterName: 'Rae', reporterEmail: 'rae@example.test', byMember: false }],
  });
});

test('relisting puts the Debate back in the feed and out of the queue', async () => {
  const id = await flagged();
  const res = await decide(id, { action: 'relist' }, await moderator());
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ visibility: 'listed' });
  expect((await listCompletedDebates(env.DB, 100)).map(d => d.id)).toContain(id);
  const { items } = (await (await queue(await moderator())).json()) as { items: { id: string }[] };
  expect(items.map(i => i.id)).not.toContain(id);
});

test('blocking stores the statement of reasons', async () => {
  const id = await flagged();
  expect((await decide(id, block, await moderator())).status).toBe(201);
  expect((await getDebate(env.DB, id))?.visibility).toBe('blocked');
  const row = await env.DB.prepare('SELECT * FROM moderation_decisions WHERE debate_id = ?').bind(id).first();
  expect(row).toMatchObject({ action: 'block', source: 'ai_flag', automated_detection: 1, ground: 'terms', ground_ref: 'Terms §3 Hate' });
});

test.each([
  [{ action: 'block' }],
  [{ ...block, explanation: 'short' }],
  [{ ...block, ground: 'vibes' }],
  [{ ...block, groundRef: '' }],
  [{ action: 'delete' }],
])('blocking needs a ground, a reference and an explanation (%#)', async body => {
  const id = await flagged();
  expect((await decide(id, body, await moderator())).status).toBe(400);
  expect((await getDebate(env.DB, id))?.visibility).toBe('unlisted');
});

test('after a relist, a later Block is recorded as Report-driven, not as the AI Flag', async () => {
  const id = await flagged();
  const headers = await moderator();
  await decide(id, { action: 'relist' }, headers);
  await exports.default.fetch(`${base}/debates/${id}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': uniqueId('m') },
    body: JSON.stringify({ reason: 'hate', explanation: 'It attacks a group of people.', goodFaith: true }),
  });
  expect((await decide(id, block, headers)).status).toBe(201);
  const row = await env.DB.prepare(`SELECT source, automated_detection FROM moderation_decisions WHERE debate_id = ? AND action = 'block'`)
    .bind(id)
    .first();
  expect(row).toEqual({ source: 'reports', automated_detection: 0 });
});

test('blocking twice is 409', async () => {
  const id = await flagged();
  const headers = await moderator();
  expect((await decide(id, block, headers)).status).toBe(201);
  expect((await decide(id, block, headers)).status).toBe(409);
  expect((await decide(id, { action: 'relist' }, headers)).status).toBe(409);
});

test('non-Moderators cannot decide', async () => {
  const id = await flagged();
  expect((await decide(id, block, new Headers())).status).toBe(401);
  expect((await decide(id, block, (await signedInHeaders()).headers)).status).toBe(403);
  expect((await decide('nope', block, await moderator())).status).toBe(404);
});
