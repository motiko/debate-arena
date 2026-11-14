import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, completeDebate, createDebate, failDebate, listCompletedDebates } from '../src/db/debates';
import { newDebate, turnAt, uniqueId } from './helpers';

const base = 'https://api.test/api';

async function batchDebate(memberId: string, complete = false) {
  const d = newDebate({ kind: 'batch', memberId, quotaPoints: 1 });
  await createDebate(env.DB, d);
  if (complete) {
    for (let i = 0; i < 6; i++) await appendTurn(env.DB, d.id, i, turnAt(i));
    await completeDebate(env.DB, d.id, null, new Date().toISOString());
  }
  return d.id;
}

const view = (id: string, member?: string) =>
  exports.default.fetch(`${base}/debates/${id}`, { headers: member ? { 'x-dev-member': member } : {} });

test('a running Batch Debate is hidden from other Viewers', async () => {
  const id = await batchDebate(uniqueId('dev-starter'));
  expect((await view(id)).status).toBe(404);
  expect((await view(id, uniqueId('dev-other'))).status).toBe(404);
});

test('its starting Member sees it is being generated', async () => {
  const starter = uniqueId('dev-starter');
  const id = await batchDebate(starter);
  const res = await view(id, starter);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, kind: 'batch', status: 'running', turns: [], mine: true });
});

test('a complete Batch Debate is public and labelled batch', async () => {
  const id = await batchDebate(uniqueId('dev-starter'), true);
  const res = await view(id);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { kind: string; turns: unknown[] };
  expect(body.kind).toBe('batch');
  expect(body.turns).toHaveLength(6);
  const feed = (await (await exports.default.fetch(`${base}/debates`)).json()) as { debates: { id: string; kind: string }[] };
  expect(feed.debates.find(d => d.id === id)?.kind).toBe('batch');
  expect((await listCompletedDebates(env.DB, 100)).some(d => d.id === id)).toBe(true);
});

test('a failed Batch Debate is never published', async () => {
  const starter = uniqueId('dev-starter');
  const d = newDebate({ kind: 'batch', memberId: starter, quotaPoints: 1 });
  await createDebate(env.DB, d);
  await appendTurn(env.DB, d.id, 0, turnAt(0));
  await failDebate(env.DB, d.id, 'test');
  expect((await view(d.id)).status).toBe(404);
  const own = await view(d.id, starter);
  expect(own.status).toBe(200);
  expect(await own.json()).toMatchObject({ status: 'failed', turns: [] });
});

test('Batch Debates take no Audience Votes', async () => {
  const id = await batchDebate(uniqueId('dev-starter'), true);
  const res = await exports.default.fetch(`${base}/debates/${id}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': uniqueId('m') },
    body: JSON.stringify({ phase: 'before', stance: 'for' }),
  });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'Batch Debates take no Audience Votes' });
});

test('a Batch Debate has no live stream', async () => {
  const id = await batchDebate(uniqueId('dev-starter'));
  const res = await exports.default.fetch(`${base}/debates/${id}/live`, { headers: { upgrade: 'websocket' } });
  expect(res.status).toBe(404);
});

test('a complete Batch Debate does not ask a signed-in Member for a before-vote', async () => {
  const id = await batchDebate(uniqueId('dev-starter'), true);
  const body = (await (await view(id, uniqueId('dev-reader'))).json()) as { turnsHidden: boolean; turns: unknown[] };
  expect(body.turnsHidden).toBe(false);
  expect(body.turns).toHaveLength(6);
});
