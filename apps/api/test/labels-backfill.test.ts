import { env, exports } from 'cloudflare:workers';
import { CATEGORIES } from '@debate-arena/engine';
import { expect, test } from 'vitest';
import { completeDebate, createDebate, getDebate } from '../src/db/debates';
import { newDebate, sampleSetup } from './helpers';

interface Round { labelled: number; failed: number; remaining: number; next: string | null }

const label = (member: string, body: unknown = {}) =>
  exports.default.fetch('https://api.test/api/moderation/labels', {
    method: 'POST',
    headers: { 'x-dev-member': member, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function completed(opts: { visibility?: 'listed' | 'unlisted'; motion?: string; at?: string } = {}) {
  const d = newDebate({ setup: { ...sampleSetup, motion: { text: opts.motion ?? 'Remote work beats office work' } } });
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, opts.at ?? '2026-11-14T00:00:00.000Z');
  if (opts.visibility === 'unlisted') await env.DB.prepare(`UPDATE debates SET visibility = 'unlisted' WHERE id = ?`).bind(d.id).run();
  return d.id;
}

/** Runs the backfill the way the Moderation page does: round after round, passing the cursor on, until it ends. */
async function backfill(): Promise<{ labelled: number; failed: number }> {
  let after: string | null = null;
  let labelled = 0;
  let failed = 0;
  for (let round = 0; round < 100; round++) {
    const res = await label('dev-mod-1', after ? { after } : {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Round;
    expect(body.labelled + body.failed).toBeLessThanOrEqual(10);
    labelled += body.labelled;
    failed += body.failed;
    if (!body.next) {
      expect(body.remaining).toBe(0);
      return { labelled, failed };
    }
    after = body.next;
  }
  throw new Error('the backfill never ended');
}

test('only Moderators can label older Debates', async () => {
  expect((await label('dev-1')).status).toBe(403);
});

test('the backfill takes JSON only, like every other change', async () => {
  const res = await exports.default.fetch('https://api.test/api/moderation/labels', { method: 'POST', headers: { 'x-dev-member': 'dev-mod-1' } });
  expect(res.status).toBe(415);
});

test('a Moderator labels unlabelled listed Debates and leaves Unlisted ones alone', async () => {
  const listed = [await completed(), await completed()];
  const unlisted = await completed({ visibility: 'unlisted' });
  await backfill();
  for (const id of listed) {
    const d = await getDebate(env.DB, id);
    expect(CATEGORIES).toContain(d?.category);
    expect(d?.tags).toEqual(['local dev', 'fake']);
  }
  expect((await getDebate(env.DB, unlisted))?.category).toBeNull();
});

test('Debates the labeller cannot label are passed over, so newer ones still get labelled', async () => {
  const stubborn = [];
  for (let i = 0; i < 12; i++) stubborn.push(await completed({ motion: `Unlabellable ${i} [label-fail-test]`, at: '2026-01-01T00:00:00.000Z' }));
  const newer = await completed({ at: '2026-11-15T00:00:00.000Z' });
  const { failed } = await backfill();
  expect(failed).toBeGreaterThanOrEqual(12);
  expect(CATEGORIES).toContain((await getDebate(env.DB, newer))?.category);
  expect((await getDebate(env.DB, stubborn[0]!))?.category).toBeNull();
});
