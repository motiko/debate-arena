import { FakeModelClient, JUDGE_OUTPUT_TOKENS, STANCE_OUTPUT_TOKENS } from '@debate-arena/engine';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { createDebate, getDebate } from '../src/db/debates';
import { quotaRemaining, spendQuota } from '../src/db/quota';
import { failStep, runStep, type StepDeps } from '../src/debates/steps';
import type { StepJob } from '../src/debates/start';
import type { DebateEvent } from '../src/live/events';
import { newDebate } from './helpers';

const voters = Array.from({ length: 10 }, (_, i) => `fake-${'abcd'[i % 4]}/one`);

function makeDeps() {
  const jobs: StepJob[] = [];
  const events: DebateEvent[] = [];
  const client = new FakeModelClient(r =>
    r.maxOutputTokens === JUDGE_OUTPUT_TOKENS
      ? '{"winner":"for","reasoning":"Stronger evidence."}'
      : r.maxOutputTokens === STANCE_OUTPUT_TOKENS
        ? r.messages.some(m => m.content.includes('heard the whole debate'))
          ? 'for'
          : 'undecided'
        : 'An argument.',
  );
  const deps: StepDeps = {
    db: env.DB,
    client,
    notify: async (_id, event) => {
      events.push(event);
    },
    enqueue: async job => {
      jobs.push(job);
    },
    now: () => new Date('2026-11-13T12:30:00Z'),
  };
  return { deps, jobs, events, client };
}

test('drives a Classic Debate to completion one step at a time', async () => {
  const { deps, jobs, events } = makeDeps();
  const d = newDebate();
  await createDebate(env.DB, d);
  jobs.push({ debateId: d.id });
  const outcomes = [];
  while (jobs.length) outcomes.push(await runStep(deps, jobs.shift()!));
  expect(outcomes).toEqual(['turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'verdict', 'complete']);
  const stored = await getDebate(env.DB, d.id);
  expect(stored).toMatchObject({ status: 'complete', verdict: { winner: 'for' }, completedAt: '2026-11-13T12:30:00.000Z' });
  expect(stored?.turns).toHaveLength(6);
  expect(events.map(e => e.type)).toEqual(['turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'verdict', 'complete']);
  expect(events[0]).toMatchObject({ type: 'turn', slotIndex: 0, turn: { side: 'for' } });
});

test('with AI Voters the completion carries the AI Audience Result', async () => {
  const { deps, jobs, events } = makeDeps();
  const d = newDebate({ aiVoters: voters });
  await createDebate(env.DB, d);
  jobs.push({ debateId: d.id });
  while (jobs.length) await runStep(deps, jobs.shift()!);
  expect(events.at(-1)).toMatchObject({ type: 'complete', aiAudience: { counted: 10, winner: 'for', dropped: [] } });
  expect((await getDebate(env.DB, d.id))?.aiAudience?.counted).toBe(10);
});

test('a redelivered job running concurrently writes one Turn and notifies once', async () => {
  const { deps, jobs, events } = makeDeps();
  const d = newDebate();
  await createDebate(env.DB, d);
  const outcomes = await Promise.all([runStep(deps, { debateId: d.id }), runStep(deps, { debateId: d.id })]);
  expect(outcomes.toSorted()).toEqual(['skipped', 'turn']);
  expect((await getDebate(env.DB, d.id))?.turns).toHaveLength(1);
  expect(events.filter(e => e.type === 'turn')).toHaveLength(1);
  expect(jobs).toHaveLength(1);
});

test('jobs for unknown, complete or failed Debates are skipped without model calls', async () => {
  const { deps, client } = makeDeps();
  const d = newDebate();
  await createDebate(env.DB, d);
  await failStep(deps, d.id, 'test');
  expect(await runStep(deps, { debateId: d.id })).toBe('skipped');
  expect(await runStep(deps, { debateId: 'nope' })).toBe('skipped');
  expect(client.calls).toHaveLength(0);
});

test('failStep refunds Quota once and notifies failed once', async () => {
  const { deps, events } = makeDeps();
  const d = newDebate({ memberId: `m-${crypto.randomUUID()}` });
  await spendQuota(env.DB, d.memberId, 2, new Date(d.createdAt));
  await createDebate(env.DB, d);
  await failStep(deps, d.id, 'Model unavailable');
  await failStep(deps, d.id, 'Model unavailable');
  expect(await quotaRemaining(env.DB, d.memberId, new Date(d.createdAt))).toBe(6);
  // Viewers get a plain message; the internal reason is only stored.
  expect(events).toEqual([{ type: 'failed', reason: 'The Debate could not be completed.' }]);
  expect((await getDebate(env.DB, d.id))?.failureReason).toBe('Model unavailable');
});
