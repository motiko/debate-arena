import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, completeDebate, createDebate, failDebate, getDebate, saveVerdict } from '../src/db/debates';
import { checkVote, votingClosesAt } from '../src/votes/rules';
import { newDebate, turnAt, uniqueId } from './helpers';

const base = 'https://api.test/api';
const verdict = { winner: 'for' as const, reasoning: 'Clearer.', judges: ['fake-c/one'] };

async function debate(state: 'running' | 'complete' | 'failed', completedAt = new Date(Date.now() - 3600_000).toISOString()) {
  const d = newDebate();
  await createDebate(env.DB, d);
  if (state === 'failed') await failDebate(env.DB, d.id, 'test');
  if (state === 'complete') {
    for (let i = 0; i < 6; i++) await appendTurn(env.DB, d.id, i, turnAt(i));
    await saveVerdict(env.DB, d.id, verdict);
    await completeDebate(env.DB, d.id, null, completedAt);
  }
  return d.id;
}

const member = () => ({ 'x-dev-member': uniqueId('m') });

function vote(id: string, headers: Record<string, string>, payload: unknown) {
  return exports.default.fetch(`${base}/debates/${id}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

const view = async (id: string, headers: Record<string, string> = {}) =>
  (await (await exports.default.fetch(`${base}/debates/${id}`, { headers })).json()) as {
    turns: unknown[];
    turnsHidden: boolean;
    myVote: { before: string | null; after: string | null } | null;
    audienceResult: { counted: number; winner: string; votingClosesAt: string | null };
  };

test('before, then after when complete, updates the Audience Result', async () => {
  const id = await debate('complete');
  const [a, b] = [member(), member()];
  expect((await vote(id, a, { phase: 'before', stance: 'undecided' })).status).toBe(201);
  expect((await vote(id, b, { phase: 'before', stance: 'against' })).status).toBe(201);
  expect((await vote(id, a, { phase: 'after', stance: 'for' })).status).toBe(201);
  const res = await vote(id, b, { phase: 'after', stance: 'for' });
  expect(await res.json()).toEqual({ vote: { before: 'against', after: 'for' } });
  const v = await view(id, a);
  expect(v.audienceResult).toMatchObject({ counted: 2, winner: 'for' });
  expect(v.myVote).toEqual({ before: 'undecided', after: 'for' });
});

test('Turns are hidden from a signed-in Member until their before-vote', async () => {
  const id = await debate('complete');
  const m = member();
  expect(await view(id, m)).toMatchObject({ turns: [], turnsHidden: true, myVote: null });
  await vote(id, m, { phase: 'before', stance: 'for' });
  const after = await view(id, m);
  expect(after.turnsHidden).toBe(false);
  expect(after.turns).toHaveLength(6);
});

test('signed-out Viewers still see Turns', async () => {
  const id = await debate('complete');
  expect(await view(id)).toMatchObject({ turnsHidden: false, myVote: null });
  expect((await view(id)).turns).toHaveLength(6);
});

test.each(['before', 'after'] as const)('a second %s-vote is 409 and keeps the first stance', async phase => {
  const id = await debate('complete');
  const m = member();
  await vote(id, m, { phase: 'before', stance: 'for' });
  if (phase === 'after') await vote(id, m, { phase: 'after', stance: 'for' });
  const res = await vote(id, m, { phase, stance: 'against' });
  expect(res.status).toBe(409);
  expect((await view(id, m)).myVote?.[phase]).toBe('for');
});

test('an after-vote while running, or without a before-vote, is 403', async () => {
  const running = await debate('running');
  const m = member();
  await vote(running, m, { phase: 'before', stance: 'for' });
  const early = await vote(running, m, { phase: 'after', stance: 'for' });
  expect(early.status).toBe(403);
  expect(await early.json()).toEqual({ error: 'Vote again when the Debate is complete' });
  const complete = await debate('complete');
  const noBefore = await vote(complete, member(), { phase: 'after', stance: 'for' });
  expect(noBefore.status).toBe(403);
  expect(await noBefore.json()).toEqual({ error: 'Vote before reading the Debate first' });
});

test('the window closes exactly 7 days after completion', async () => {
  const completedAt = '2026-11-01T00:00:00.000Z';
  const d = (await getDebate(env.DB, await debate('complete', completedAt)))!;
  expect(votingClosesAt(d)).toBe('2026-11-08T00:00:00.000Z');
  const existing = { debateId: d.id, memberId: 'm', before: 'for' as const, after: null };
  expect(checkVote(d, existing, 'after', new Date('2026-11-07T23:59:59.000Z'))).toEqual({ ok: true });
  expect(checkVote(d, existing, 'after', new Date('2026-11-08T00:00:00.000Z'))).toEqual({
    ok: false,
    status: 403,
    error: 'Voting is closed for this Debate',
  });
});

test('votes on a failed Debate are refused', async () => {
  const id = await debate('failed');
  const res = await vote(id, member(), { phase: 'before', stance: 'for' });
  expect(res.status).toBe(403);
});

test('invalid phase or stance is 400; unknown Debate is 404; signed out is 401', async () => {
  const id = await debate('complete');
  expect((await vote(id, member(), { phase: 'during', stance: 'for' })).status).toBe(400);
  expect((await vote(id, member(), { phase: 'before', stance: 'maybe' })).status).toBe(400);
  expect((await vote('nope', member(), { phase: 'before', stance: 'for' })).status).toBe(404);
  expect((await vote(id, {}, { phase: 'before', stance: 'for' })).status).toBe(401);
});
