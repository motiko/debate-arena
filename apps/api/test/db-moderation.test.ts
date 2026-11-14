import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { completeDebate, createDebate, getDebate, listCompletedDebates } from '../src/db/debates';
import { recordDecision, saveScreen, unlistForReports } from '../src/db/moderation';
import { newDebate } from './helpers';

const at = '2026-11-14T10:00:00.000Z';

async function completed(motion = 'A Motion') {
  const d = newDebate({ setup: { ...newDebate().setup, motion: { text: motion } } });
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, new Date().toISOString());
  return d.id;
}

const decision = (debateId: string, action: 'relist' | 'block') => ({
  id: crypto.randomUUID(),
  debateId,
  action,
  source: 'moderator' as const,
  automatedDetection: false,
  ground: action === 'block' ? ('terms' as const) : null,
  groundRef: action === 'block' ? 'Terms §3' : null,
  explanation: action === 'block' ? 'Targets a group with hate.' : null,
  moderatorId: 'mod-1',
  decidedAt: at,
});

test('a new Debate is listed and unscreened', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ visibility: 'listed', flagged: false, screen: null, screenedAt: null, reviewedAt: null });
});

test('a screen is saved once; a Flag Unlists', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await saveScreen(env.DB, d.id, { flagged: true, categories: ['S10'] }, at)).toBe(true);
  expect(await saveScreen(env.DB, d.id, { flagged: false, categories: [] }, at)).toBe(false);
  expect(await getDebate(env.DB, d.id)).toMatchObject({
    visibility: 'unlisted',
    flagged: true,
    screen: { flagged: true, categories: ['S10'] },
    screenedAt: at,
  });
});

test('a safe screen keeps the Debate listed', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  await saveScreen(env.DB, d.id, { flagged: false, categories: ['S13'] }, at);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ visibility: 'listed', flagged: false });
});

test('the feed leaves out Unlisted and Blocked Debates', async () => {
  const [listed, unlisted, blocked] = [await completed(), await completed(), await completed()];
  await unlistForReports(env.DB, unlisted);
  await recordDecision(env.DB, decision(blocked, 'block'));
  const ids = (await listCompletedDebates(env.DB, 100)).map(d => d.id);
  expect(ids).toContain(listed);
  expect(ids).not.toContain(unlisted);
  expect(ids).not.toContain(blocked);
});

test('relisting returns a Debate to the feed and records the review', async () => {
  const id = await completed();
  await unlistForReports(env.DB, id);
  expect(await recordDecision(env.DB, decision(id, 'relist'))).toBe(true);
  expect(await getDebate(env.DB, id)).toMatchObject({ visibility: 'listed', reviewedAt: at });
});

test('a second decision after a Block changes nothing', async () => {
  const id = await completed();
  expect(await recordDecision(env.DB, decision(id, 'block'))).toBe(true);
  expect(await recordDecision(env.DB, decision(id, 'relist'))).toBe(false);
  expect((await getDebate(env.DB, id))?.visibility).toBe('blocked');
  const { results } = await env.DB.prepare('SELECT action FROM moderation_decisions WHERE debate_id = ?').bind(id).all();
  expect(results).toEqual([{ action: 'block' }]);
});
