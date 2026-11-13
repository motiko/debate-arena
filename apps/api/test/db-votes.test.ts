import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { createDebate } from '../src/db/debates';
import { castAfter, castBefore, getVote, listVotes } from '../src/db/votes';
import { newDebate } from './helpers';

const at = '2026-11-13T12:00:00.000Z';

async function debate() {
  const d = newDebate();
  await createDebate(env.DB, d);
  return d.id;
}

test('a before- then after-vote round-trips', async () => {
  const id = await debate();
  expect(await castBefore(env.DB, id, 'm1', 'undecided', at)).toBe(true);
  expect(await castAfter(env.DB, id, 'm1', 'for', at)).toBe(true);
  expect(await getVote(env.DB, id, 'm1')).toEqual({ debateId: id, memberId: 'm1', before: 'undecided', after: 'for' });
});

test('a second before-vote is refused and the first is kept', async () => {
  const id = await debate();
  await castBefore(env.DB, id, 'm1', 'for', at);
  expect(await castBefore(env.DB, id, 'm1', 'against', at)).toBe(false);
  expect((await getVote(env.DB, id, 'm1'))?.before).toBe('for');
});

test('an after-vote needs a before-vote', async () => {
  const id = await debate();
  expect(await castAfter(env.DB, id, 'm1', 'for', at)).toBe(false);
  expect(await getVote(env.DB, id, 'm1')).toBeNull();
});

test('a second after-vote is refused and the first is kept', async () => {
  const id = await debate();
  await castBefore(env.DB, id, 'm1', 'for', at);
  await castAfter(env.DB, id, 'm1', 'against', at);
  expect(await castAfter(env.DB, id, 'm1', 'for', at)).toBe(false);
  expect((await getVote(env.DB, id, 'm1'))?.after).toBe('against');
});

test('listVotes returns every Member’s vote for one Debate only', async () => {
  const [a, b] = [await debate(), await debate()];
  await castBefore(env.DB, a, 'm1', 'for', at);
  await castBefore(env.DB, a, 'm2', 'against', at);
  await castBefore(env.DB, b, 'm3', 'for', at);
  const votes = await listVotes(env.DB, a);
  expect(votes.map(v => v.memberId).toSorted()).toEqual(['m1', 'm2']);
});
