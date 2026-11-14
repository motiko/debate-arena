import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, completeDebate, createDebate } from '../src/db/debates';
import { recordDecision, unlistForReports } from '../src/db/moderation';
import { newDebate, sampleSetup, turnAt, uniqueId } from './helpers';

const base = 'https://api.test/api';
const motion = 'A Motion that a Moderator will Block';

async function completed(memberId = uniqueId('m')) {
  const d = newDebate({ memberId, setup: { ...sampleSetup, motion: { text: motion } } });
  await createDebate(env.DB, d);
  for (let i = 0; i < 6; i++) await appendTurn(env.DB, d.id, i, turnAt(i));
  await completeDebate(env.DB, d.id, null, new Date().toISOString());
  return d.id;
}

async function block(id: string) {
  await recordDecision(env.DB, {
    id: crypto.randomUUID(),
    debateId: id,
    action: 'block',
    source: 'reports',
    automatedDetection: false,
    ground: 'terms',
    groundRef: 'Terms §3 Hate',
    explanation: 'The Motion attacks a group of people.',
    moderatorId: 'mod-1',
    decidedAt: '2026-11-14T10:00:00.000Z',
  });
}

test('a Blocked Debate is 410 with only the statement of reasons', async () => {
  const id = await completed();
  await block(id);
  const res = await exports.default.fetch(`${base}/debates/${id}`);
  expect(res.status).toBe(410);
  const text = await res.text();
  expect(text).not.toContain(motion);
  expect(text).not.toContain('Turn 0');
  expect(JSON.parse(text)).toEqual({
    id,
    blocked: { decidedAt: '2026-11-14T10:00:00.000Z', ground: 'terms', groundRef: 'Terms §3 Hate', explanation: 'The Motion attacks a group of people.' },
  });
});

test('an Unlisted Debate is still reachable by link', async () => {
  const id = await completed();
  await unlistForReports(env.DB, id);
  const res = await exports.default.fetch(`${base}/debates/${id}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, motion, visibility: 'unlisted' });
});

test('mine is true only for the starting Member', async () => {
  const id = await completed('dev-starter-1');
  const view = async (member?: string) =>
    (await (await exports.default.fetch(`${base}/debates/${id}`, { headers: member ? { 'x-dev-member': member } : {} })).json()) as {
      mine: boolean;
    };
  expect((await view('dev-starter-1')).mine).toBe(true);
  expect((await view('someone-else')).mine).toBe(false);
  expect((await view()).mine).toBe(false);
});

test('votes and live on a Blocked Debate are 410', async () => {
  const id = await completed();
  await block(id);
  const vote = await exports.default.fetch(`${base}/debates/${id}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': uniqueId('m') },
    body: JSON.stringify({ phase: 'before', stance: 'for' }),
  });
  expect(vote.status).toBe(410);
  const live = await exports.default.fetch(`${base}/debates/${id}/live`, { headers: { upgrade: 'websocket' } });
  expect(live.status).toBe(410);
});
