import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import {
  addCost,
  appendTurn,
  completeDebate,
  createDebate,
  failDebate,
  getDebate,
  listCompletedDebates,
  saveLabels,
  saveVerdict,
} from '../src/db/debates';
import { newDebate, turnAt } from './helpers';

const verdict = { winner: 'for' as const, reasoning: 'Clearer case.', scores: [], judges: ['fake-c/one'], confidence: null, crux: '', claims: [], ballots: [] };

test('round-trips a new Debate', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await getDebate(env.DB, d.id)).toEqual({
    ...d,
    status: 'running',
    costMicroUsd: 0,
    turns: [],
    verdict: null,
    aiAudience: null,
    completedAt: null,
    failureReason: null,
    visibility: 'listed',
    flagged: false,
    screen: null,
    screenedAt: null,
    reviewedAt: null,
    kind: 'live',
    models: null,
    turnDeadline: null,
    category: null,
    tags: [],
  });
});

test('appendTurn is idempotent per slot', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await appendTurn(env.DB, d.id, 0, turnAt(0))).toBe(true);
  expect(await appendTurn(env.DB, d.id, 0, turnAt(0, 'other'))).toBe(false);
  expect((await getDebate(env.DB, d.id))?.turns).toEqual([turnAt(0)]);
});

test('Turns come back in slot order', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  await appendTurn(env.DB, d.id, 1, turnAt(1));
  await appendTurn(env.DB, d.id, 0, turnAt(0));
  expect((await getDebate(env.DB, d.id))?.turns).toEqual([turnAt(0), turnAt(1)]);
});

test('saveVerdict and completeDebate apply once', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await saveVerdict(env.DB, d.id, verdict)).toBe(true);
  expect(await saveVerdict(env.DB, d.id, { ...verdict, winner: 'against' })).toBe(false);
  expect(await completeDebate(env.DB, d.id, null, '2026-11-13T12:05:00.000Z')).toBe(true);
  expect(await completeDebate(env.DB, d.id, null, '2026-11-13T12:09:00.000Z')).toBe(false);
  expect(await getDebate(env.DB, d.id)).toMatchObject({
    status: 'complete',
    verdict,
    completedAt: '2026-11-13T12:05:00.000Z',
  });
});

test('a failed Debate cannot complete', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await failDebate(env.DB, d.id, 'Model unavailable')).toBe(true);
  expect(await failDebate(env.DB, d.id, 'again')).toBe(false);
  expect(await completeDebate(env.DB, d.id, null, '2026-11-13T12:05:00.000Z')).toBe(false);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ status: 'failed', failureReason: 'Model unavailable' });
});

test('listCompletedDebates is newest first and paginates', async () => {
  const ids: string[] = [];
  for (const minute of ['01', '02', '03']) {
    const d = newDebate({ createdAt: '2026-11-14T00:00:00.000Z' });
    await createDebate(env.DB, d);
    await completeDebate(env.DB, d.id, null, `2026-11-14T00:${minute}:00.000Z`);
    ids.push(d.id);
  }
  await createDebate(env.DB, newDebate());
  const page = await listCompletedDebates(env.DB, 2);
  expect(page.map(d => d.id)).toEqual([ids[2], ids[1]]);
  const next = await listCompletedDebates(env.DB, 2, page[1]!.completedAt!);
  expect(next[0]?.id).toBe(ids[0]);
});

test('addCost accumulates', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  await addCost(env.DB, d.id, 100);
  await addCost(env.DB, d.id, 250);
  expect((await getDebate(env.DB, d.id))?.costMicroUsd).toBe(350);
});

test('getDebate returns null for unknown ids', async () => {
  expect(await getDebate(env.DB, 'nope')).toBeNull();
});

test('a Debate is unlabelled until saveLabels', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ category: null, tags: [] });
  await saveLabels(env.DB, d.id, { category: 'science', tags: ['space'] });
  expect(await getDebate(env.DB, d.id)).toMatchObject({ category: 'science', tags: ['space'] });
});
