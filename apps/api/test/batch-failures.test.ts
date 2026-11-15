import { MAX_ATTEMPTS } from '@debate-arena/engine';
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { getDebate } from '../src/db/debates';
import { quotaRemaining, spendQuota } from '../src/db/quota';
import { consumer, MAX_BATCH_WAITS } from '../src/debates/consumer';
import type { StepJob } from '../src/debates/start';
import { FakeBatchApi, type BatchApi } from '../src/models/batch';
import { createScreened, newDebate, uniqueId } from './helpers';

/**
 * Drives one Debate through the consumer the way the queue would: every message the consumer sends (and every
 * retry) is delivered next, until no message is left. Returns how many deliveries it took.
 */
async function drive(debateId: string, api: BatchApi, limit = 60): Promise<number> {
  const queue: { job: StepJob; attempts: number }[] = [{ job: { debateId }, attempts: 1 }];
  const sender = {
    send: async (job: StepJob) => void queue.push({ job, attempts: 1 }),
  };
  const testEnv = { ...env, STEP_QUEUE: sender as unknown as Queue };
  let deliveries = 0;
  while (queue.length && deliveries < limit) {
    const { job, attempts } = queue.shift()!;
    deliveries += 1;
    const batch = createMessageBatch<StepJob>('debate-steps', [{ id: `m-${crypto.randomUUID()}`, timestamp: new Date(), attempts, body: job }]);
    const ctx = createExecutionContext();
    await consumer(batch, testEnv, ctx, { batchApi: api });
    // A message.retry() is delivered again with one more attempt.
    const result = await getQueueResult(batch, ctx);
    if (result.retryMessages.length > 0) queue.push({ job, attempts: attempts + 1 });
  }
  return deliveries;
}

/** A Batch API whose every batch fails (e.g. expired, or refused by the provider). */
const alwaysFailing: BatchApi = {
  async submit() {
    return `fail-${crypto.randomUUID()}`;
  },
  async get() {
    return { status: 'failed', reason: 'expired' };
  },
};

test('a batch call that keeps failing fails the Debate', async () => {
  const d = newDebate({ kind: 'batch', memberId: uniqueId('m') });
  await createScreened(env.DB, d);
  const deliveries = await drive(d.id, alwaysFailing);
  expect(deliveries).toBeLessThan(60);
  expect((await getDebate(env.DB, d.id))?.status).toBe('failed');
  const { results } = await env.DB.prepare('SELECT failures FROM batch_calls WHERE debate_id = ?').bind(d.id).all<{ failures: number }>();
  expect(results).toEqual([{ failures: MAX_ATTEMPTS }]);
});

test('a step that keeps failing in a Batch Debate fails after MAX_ATTEMPTS, even across waits', async () => {
  const d = newDebate({ kind: 'batch', memberId: uniqueId('m') });
  await createScreened(env.DB, d);
  // Every Turn comes back empty: the engine rejects it, and the step is retried with fresh batch calls.
  const empty = new FakeBatchApi(() => '', 0);
  const deliveries = await drive(d.id, empty);
  expect(deliveries).toBeLessThan(60);
  expect((await getDebate(env.DB, d.id))?.status).toBe('failed');
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM batch_calls WHERE debate_id = ?').bind(d.id).all<{ n: number }>();
  // The retry asked the model again (the first empty answer was discarded, the second kept for the record).
  expect(results[0]?.n).toBeGreaterThanOrEqual(1);
});

test('a Batch Debate that waits too long fails', async () => {
  const d = newDebate({ kind: 'batch', memberId: uniqueId('m') });
  await createScreened(env.DB, d);
  const never: BatchApi = { submit: async () => 'never', get: async () => ({ status: 'pending' }) };
  const batch = createMessageBatch<StepJob>('debate-steps', [
    { id: 'm-wait', timestamp: new Date(), attempts: 1, body: { debateId: d.id, waits: MAX_BATCH_WAITS } },
  ]);
  await consumer(batch, { ...env, STEP_QUEUE: { send: async () => {} } as unknown as Queue }, createExecutionContext(), { batchApi: never });
  expect((await getDebate(env.DB, d.id))?.status).toBe('failed');
});

test('a failed Batch Debate that already sent batches is not refunded', async () => {
  const member = uniqueId('m');
  const d = newDebate({ kind: 'batch', memberId: member, quotaPoints: 1, createdAt: new Date().toISOString() });
  await spendQuota(env.DB, member, 1, new Date());
  await createScreened(env.DB, d);
  await drive(d.id, alwaysFailing);
  expect((await getDebate(env.DB, d.id))?.status).toBe('failed');
  expect(await quotaRemaining(env.DB, member, new Date())).toBe(23);
});
