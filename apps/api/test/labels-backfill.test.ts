import { env, exports } from 'cloudflare:workers';
import { CATEGORIES } from '@debate-arena/engine';
import { expect, test } from 'vitest';
import { completeDebate, createDebate, getDebate } from '../src/db/debates';
import { newDebate } from './helpers';

const label = (member: string) =>
  exports.default.fetch('https://api.test/api/moderation/labels', { method: 'POST', headers: { 'x-dev-member': member } });

async function completed(visibility: 'listed' | 'unlisted' = 'listed') {
  const d = newDebate();
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, '2026-11-14T00:00:00.000Z');
  if (visibility === 'unlisted') await env.DB.prepare(`UPDATE debates SET visibility = 'unlisted' WHERE id = ?`).bind(d.id).run();
  return d.id;
}

test('only Moderators can label older Debates', async () => {
  expect((await label('dev-1')).status).toBe(403);
});

test('a Moderator labels unlabelled listed Debates, ten at a time, and leaves Unlisted ones alone', async () => {
  const listed = [await completed(), await completed()];
  const unlisted = await completed('unlisted');
  let remaining = Infinity;
  for (let round = 0; round < 50 && remaining > 0; round++) {
    const res = await label('dev-mod-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labelled: number; remaining: number };
    expect(body.labelled).toBeLessThanOrEqual(10);
    remaining = body.remaining;
  }
  expect(remaining).toBe(0);
  for (const id of listed) {
    const d = await getDebate(env.DB, id);
    expect(CATEGORIES).toContain(d?.category);
    expect(d?.tags).toEqual(['local dev', 'fake']);
  }
  expect((await getDebate(env.DB, unlisted))?.category).toBeNull();
});
