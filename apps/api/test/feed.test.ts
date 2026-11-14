import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, completeDebate, createDebate } from '../src/db/debates';
import { newDebate, turnAt } from './helpers';

test('a feed entry says when its Audience voting closes, so the web can hide the outcome until then', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  for (let i = 0; i < 6; i++) await appendTurn(env.DB, d.id, i, turnAt(i));
  const completedAt = new Date().toISOString();
  await completeDebate(env.DB, d.id, null, completedAt);
  const feed = (await (await exports.default.fetch('https://api.test/api/debates')).json()) as {
    debates: { id: string; votingClosesAt: string | null }[];
  };
  const entry = feed.debates.find(e => e.id === d.id);
  expect(entry?.votingClosesAt).toBe(new Date(Date.parse(completedAt) + 7 * 24 * 60 * 60 * 1000).toISOString());
});
