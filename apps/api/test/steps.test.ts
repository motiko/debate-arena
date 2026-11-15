import { FakeModelClient, JUDGE_OUTPUT_TOKENS, SCREEN_OUTPUT_TOKENS, STANCE_OUTPUT_TOKENS } from '@debate-arena/engine';
import { recordDecision } from '../src/db/moderation';
import { BudgetExhaustedError } from '../src/models/factory';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { addCost, createDebate, getDebate } from '../src/db/debates';
import { quotaRemaining, spendQuota } from '../src/db/quota';
import { failStep, runStep, type StepDeps } from '../src/debates/steps';
import type { StepJob } from '../src/debates/start';
import type { DebateEvent } from '../src/live/events';
import { createScreened, newDebate, sampleSetup } from './helpers';

const voters = Array.from({ length: 10 }, (_, i) => `fake-${'abcd'[i % 4]}/one`);

function makeDeps() {
  const jobs: StepJob[] = [];
  const events: DebateEvent[] = [];
  const client = new FakeModelClient(r =>
    r.maxOutputTokens === SCREEN_OUTPUT_TOKENS
      ? r.messages.some(m => m.content.includes('[flag-test]'))
        ? 'unsafe\nS10'
        : 'safe'
      : r.maxOutputTokens === JUDGE_OUTPUT_TOKENS
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
    enqueueLater: async () => {},
    now: () => new Date('2026-11-13T12:30:00Z'),
    screener: 'fake-guard/one',
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
  expect(outcomes).toEqual(['screen', 'turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'verdict', 'complete']);
  const stored = await getDebate(env.DB, d.id);
  expect(stored).toMatchObject({ status: 'complete', verdict: { winner: 'for' }, completedAt: '2026-11-13T12:30:00.000Z' });
  expect(stored?.turns).toHaveLength(6);
  // Drafts come and go while each Turn is written (their order is tested on its own); the record is the rest.
  const settled = events.filter(e => e.type !== 'draft');
  expect(settled.map(e => e.type)).toEqual(['turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'verdict', 'complete']);
  expect(settled[0]).toMatchObject({ type: 'turn', slotIndex: 0, turn: { side: 'for' } });
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

test('the first step screens the Motion before any Turn, quietly', async () => {
  const { deps, jobs, events, client } = makeDeps();
  const d = newDebate();
  await createDebate(env.DB, d);
  expect(await runStep(deps, { debateId: d.id })).toBe('screen');
  expect(client.calls).toHaveLength(1);
  expect(client.calls[0]).toMatchObject({ model: 'fake-guard/one', maxOutputTokens: SCREEN_OUTPUT_TOKENS });
  expect(await getDebate(env.DB, d.id)).toMatchObject({ turns: [], screenedAt: '2026-11-13T12:30:00.000Z', visibility: 'listed' });
  expect(events).toEqual([]);
  expect(jobs).toEqual([{ debateId: d.id }]);
  expect(await runStep(deps, jobs.shift()!)).toBe('turn');
});

test('a flagged Motion Unlists the Debate but it still completes', async () => {
  const { deps, jobs } = makeDeps();
  const d = newDebate({ setup: { ...sampleSetup, motion: { text: 'Cats [flag-test]' } } });
  await createDebate(env.DB, d);
  jobs.push({ debateId: d.id });
  while (jobs.length) await runStep(deps, jobs.shift()!);
  expect(await getDebate(env.DB, d.id)).toMatchObject({
    status: 'complete',
    visibility: 'unlisted',
    flagged: true,
    screen: { flagged: true, categories: ['S10'] },
  });
});

test('a screening error never fails the Debate', async () => {
  const { deps, jobs } = makeDeps();
  const inner = deps.client;
  deps.client = {
    complete: async request => {
      if (request.maxOutputTokens === SCREEN_OUTPUT_TOKENS) throw new Error('screener down');
      return inner.complete(request);
    },
  };
  const d = newDebate();
  await createDebate(env.DB, d);
  jobs.push({ debateId: d.id });
  while (jobs.length) await runStep(deps, jobs.shift()!);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ status: 'complete', visibility: 'unlisted', screen: { categories: ['unscreened'] } });
});

test('a used-up Budget is not hidden by screening', async () => {
  const { deps } = makeDeps();
  deps.client = {
    complete: async () => {
      throw new BudgetExhaustedError('spent');
    },
  };
  const d = newDebate();
  await createDebate(env.DB, d);
  await expect(runStep(deps, { debateId: d.id })).rejects.toBeInstanceOf(BudgetExhaustedError);
  expect((await getDebate(env.DB, d.id))?.screenedAt).toBeNull();
});

test('a Debate Blocked while running stops: no more model calls or broadcasts', async () => {
  const { deps, events, client } = makeDeps();
  const d = newDebate();
  await createScreened(env.DB, d);
  expect(await runStep(deps, { debateId: d.id })).toBe('turn');
  await recordDecision(env.DB, {
    id: crypto.randomUUID(),
    debateId: d.id,
    action: 'block',
    source: 'moderator',
    automatedDetection: false,
    ground: 'illegal',
    groundRef: 'StGB §130',
    explanation: 'Incites hatred against a group.',
    moderatorId: 'mod-1',
    decidedAt: '2026-11-13T12:31:00.000Z',
  });
  const calls = client.calls.length;
  const sent = events.length;
  expect(await runStep(deps, { debateId: d.id })).toBe('skipped');
  expect(client.calls).toHaveLength(calls);
  expect(events).toHaveLength(sent);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ status: 'failed', visibility: 'blocked', turns: [expect.anything()] });
});

test('a step in flight when the Block lands writes nothing and tells no one', async () => {
  const { deps, events } = makeDeps();
  const d = newDebate();
  await createScreened(env.DB, d);
  const inner = deps.client;
  deps.client = {
    complete: async request => {
      // The Moderator Blocks while the model is still writing the Turn.
      await recordDecision(env.DB, {
        id: crypto.randomUUID(),
        debateId: d.id,
        action: 'block',
        source: 'moderator',
        automatedDetection: false,
        ground: 'terms',
        groundRef: 'Terms §3',
        explanation: 'Hateful Motion, blocked mid-Turn.',
        moderatorId: 'mod-1',
        decidedAt: '2026-11-13T12:31:00.000Z',
      });
      return inner.complete(request);
    },
  };
  expect(await runStep(deps, { debateId: d.id })).toBe('skipped');
  expect((await getDebate(env.DB, d.id))?.turns).toEqual([]);
  expect(events).toEqual([]);
});

test('a redelivered job running concurrently writes one Turn and notifies once', async () => {
  const { deps, jobs, events } = makeDeps();
  const d = newDebate();
  await createScreened(env.DB, d);
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

test('a failed Debate that already spent money is not refunded', async () => {
  const { deps } = makeDeps();
  const d = newDebate({ memberId: `m-${crypto.randomUUID()}` });
  await spendQuota(env.DB, d.memberId, 2, new Date(d.createdAt));
  await createDebate(env.DB, d);
  await addCost(env.DB, d.id, 1);
  await failStep(deps, d.id, 'Judge never returned a Verdict');
  expect(await quotaRemaining(env.DB, d.memberId, new Date(d.createdAt))).toBe(22);
});

test('a live Turn sends draft events before its turn event, none after', async () => {
  const { deps, events } = makeDeps();
  const d = newDebate();
  await createScreened(env.DB, d);
  expect(await runStep(deps, { debateId: d.id })).toBe('turn');
  const kinds = events.map(e => e.type);
  expect(kinds).toContain('draft');
  expect(kinds.indexOf('draft')).toBeLessThan(kinds.indexOf('turn'));
  expect(kinds.slice(kinds.indexOf('turn') + 1)).not.toContain('draft');
  expect(events.find(e => e.type === 'draft')).toMatchObject({ type: 'draft', slotIndex: 0, text: 'An' });
});

test('a Turn that fails mid-stream clears its draft, then rethrows', async () => {
  const { deps, events } = makeDeps();
  deps.client = {
    complete: async (_request, options) => {
      options?.onText?.('Half a');
      throw new Error('provider disconnected');
    },
  };
  const d = newDebate();
  await createScreened(env.DB, d);
  await expect(runStep(deps, { debateId: d.id })).rejects.toThrow('provider disconnected');
  expect(events[0]).toEqual({ type: 'draft', slotIndex: 0, text: 'Half a' });
  expect(events.at(-1)).toEqual({ type: 'draft', slotIndex: 0, text: '' });
});

test('a Turn that cannot be stored clears its draft, then rethrows', async () => {
  const { deps, events } = makeDeps();
  // The database refuses the Turn (a transient D1 error): everything else works.
  deps.db = new Proxy(env.DB, {
    get(target, key) {
      // Methods are bound to the real binding: it keeps its state in private fields.
      const value: unknown = Reflect.get(target, key);
      if (key !== 'prepare') return typeof value === 'function' ? value.bind(target) : value;
      return (sql: string) => {
        if (sql.includes('INSERT INTO turns')) throw new Error('D1 unavailable');
        return target.prepare(sql);
      };
    },
  });
  const d = newDebate();
  await createScreened(env.DB, d);
  await expect(runStep(deps, { debateId: d.id })).rejects.toThrow('D1 unavailable');
  expect(events.some(e => e.type === 'draft' && e.text !== '')).toBe(true);
  expect(events.at(-1)).toEqual({ type: 'draft', slotIndex: 0, text: '' });
});

test('failStep refunds Quota once and notifies failed once', async () => {
  const { deps, events } = makeDeps();
  const d = newDebate({ memberId: `m-${crypto.randomUUID()}` });
  await spendQuota(env.DB, d.memberId, 2, new Date(d.createdAt));
  await createDebate(env.DB, d);
  await failStep(deps, d.id, 'Model unavailable');
  await failStep(deps, d.id, 'Model unavailable');
  expect(await quotaRemaining(env.DB, d.memberId, new Date(d.createdAt))).toBe(24);
  // Viewers get a plain message; the internal reason is only stored.
  expect(events).toEqual([{ type: 'failed', reason: 'The Debate could not be completed.' }]);
  expect((await getDebate(env.DB, d.id))?.failureReason).toBe('Model unavailable');
});
