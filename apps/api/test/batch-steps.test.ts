import { FakeModelClient } from '@debate-arena/engine';
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { createDebate, getDebate } from '../src/db/debates';
import { runStep, type StepDeps } from '../src/debates/steps';
import type { StepJob } from '../src/debates/start';
import worker from '../src/index';
import { BatchPendingError, FakeBatchApi } from '../src/models/batch';
import { pollDelaySeconds } from '../src/debates/consumer';
import { deferredClient } from '../src/models/deferred';
import { devFakeReply } from '../src/models/factory';
import { JUDGE_OUTPUT_TOKENS } from '@debate-arena/engine';
import { newDebate, sampleSetup } from './helpers';

const voters = ['fake-a/one', 'fake-b/one', 'fake-c/one', 'fake-d/one'];

test('a Batch Debate completes through batch calls, without live events', async () => {
  const d = newDebate({ kind: 'batch', aiVoters: voters, budgetReservedMicroUsd: 1_000_000 });
  await createDebate(env.DB, d);
  const costs: number[] = [];
  const events: unknown[] = [];
  const screenClient = new FakeModelClient(devFakeReply);
  const jobs: StepJob[] = [{ debateId: d.id }];
  let waits = 0;
  while (jobs.length) {
    const job = jobs.shift()!;
    // A fresh client per step run, as the consumer builds one per message.
    const deps: StepDeps = {
      db: env.DB,
      client: deferredClient({
        db: env.DB,
        debateId: d.id,
        api: new FakeBatchApi(devFakeReply, 0),
        prices: { 'fake-a/one': { inputPerMTokUsd: 0.5, outputPerMTokUsd: 0.5 }, 'fake-b/one': { inputPerMTokUsd: 0.5, outputPerMTokUsd: 0.5 }, 'fake-c/one': { inputPerMTokUsd: 0.5, outputPerMTokUsd: 0.5 }, 'fake-d/one': { inputPerMTokUsd: 0.5, outputPerMTokUsd: 0.5 } },
        onCost: async n => void costs.push(n),
        guard: async () => {},
      }),
      screenClient,
      isPending: e => e instanceof BatchPendingError,
      notify: async (_id, event) => void events.push(event),
      enqueue: async next => void jobs.push(next),
      enqueueLater: async () => {},
      now: () => new Date('2026-11-14T12:00:00Z'),
      screener: 'fake-guard/one',
    };
    try {
      await runStep(deps, job);
    } catch (error) {
      if (!(error instanceof BatchPendingError)) throw error;
      waits += 1;
      jobs.push(job);
    }
    if (waits > 200) throw new Error('never finished');
  }
  const stored = await getDebate(env.DB, d.id);
  expect(stored).toMatchObject({ status: 'complete', kind: 'batch' });
  expect(stored?.turns).toHaveLength(6);
  expect(stored?.verdict).not.toBeNull();
  expect(stored?.aiAudience?.counted).toBe(4);
  expect(stored?.aiAudience?.dropped).toEqual([]);
  // Screening was a normal call; every Debate, Judge and AI Voter call went through the Batch API.
  expect(screenClient.calls).toHaveLength(1);
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM batch_calls WHERE debate_id = ?').bind(d.id).all<{ n: number }>();
  expect(results[0]?.n).toBe(6 + 1 + voters.length * 2);
  expect(costs).toHaveLength(6 + 1 + voters.length * 2);
  expect(waits).toBeGreaterThan(0);
});

test('a Slow Debate with three Judges waits for every Ballot, not the first to arrive', async () => {
  const panel = ['fake-b/one', 'fake-c/one', 'fake-d/one'];
  const d = newDebate({ kind: 'batch', budgetReservedMicroUsd: 1_000_000, setup: { ...sampleSetup, panel } });
  await createDebate(env.DB, d);
  const price = { inputPerMTokUsd: 0.5, outputPerMTokUsd: 0.5 };
  const fake = new FakeBatchApi(devFakeReply, 0);
  // The first Judge's batch is ready at once; the others stay pending for their first few polls.
  const polls = new Map<string, number>();
  const api = {
    submit: (r: Parameters<FakeBatchApi['submit']>[0]) => fake.submit(r),
    get: async (id: string, r: Parameters<FakeBatchApi['get']>[1]) => {
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      if (r.model !== 'fake-b/one' && panel.includes(r.model) && r.maxOutputTokens === JUDGE_OUTPUT_TOKENS && n < 4) return { status: 'pending' as const };
      return fake.get(id, r);
    },
  };
  const jobs: StepJob[] = [{ debateId: d.id }];
  let waits = 0;
  while (jobs.length) {
    const job = jobs.shift()!;
    const deps: StepDeps = {
      db: env.DB,
      client: deferredClient({
        db: env.DB,
        debateId: d.id,
        api,
        prices: Object.fromEntries(['fake-a/one', 'fake-b/one', 'fake-c/one', 'fake-d/one'].map(m => [m, price])),
        onCost: async () => {},
        guard: async () => {},
      }),
      screenClient: new FakeModelClient(devFakeReply),
      isPending: e => e instanceof BatchPendingError,
      notify: async () => {},
      enqueue: async next => void jobs.push(next),
      enqueueLater: async () => {},
      now: () => new Date('2026-11-14T12:00:00Z'),
      screener: 'fake-guard/one',
    };
    try {
      await runStep(deps, job);
    } catch (error) {
      if (!(error instanceof BatchPendingError)) throw error;
      waits += 1;
      jobs.push(job);
    }
    if (waits > 200) throw new Error('never finished');
  }
  const stored = await getDebate(env.DB, d.id);
  expect(stored?.verdict?.ballots.map(b => b.judge)).toEqual(panel);
  expect(stored?.verdict?.judges).toEqual(panel);
});

test('pollDelaySeconds backs off to 15 minutes, and is short with fake models', () => {
  expect([0, 1, 2, 3, 4, 10].map(w => pollDelaySeconds(w, 'openrouter'))).toEqual([60, 120, 240, 480, 900, 900]);
  expect(pollDelaySeconds(5, 'fake')).toBe(2);
});

test('waiting does not use attempts: the step is acked and sent again later', async () => {
  const d = newDebate({ kind: 'batch', setup: sampleSetup });
  await createDebate(env.DB, d);
  const sent: { job: StepJob; delaySeconds: number | undefined }[] = [];
  const queue = { send: async (job: StepJob, options?: { delaySeconds?: number }) => void sent.push({ job, delaySeconds: options?.delaySeconds }) };
  const testEnv = { ...env, STEP_QUEUE: queue as unknown as Queue };
  // Screening first (a normal call), then the first Turn is submitted as a batch and must be waited for.
  for (const waits of [undefined, 0]) {
    const batch = createMessageBatch<StepJob>('debate-steps', [
      { id: `m-${crypto.randomUUID()}`, timestamp: new Date(), attempts: 1, body: { debateId: d.id, ...(waits === undefined ? {} : { waits }) } },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, testEnv, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.retryMessages).toHaveLength(0);
    expect(result.explicitAcks).toHaveLength(1);
  }
  expect(sent.at(-1)).toEqual({ job: { debateId: d.id, waits: 1, attempt: 1 }, delaySeconds: 2 });
  expect((await getDebate(env.DB, d.id))?.status).toBe('running');
});
