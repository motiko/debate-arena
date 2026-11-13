import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { createDebate, getDebate } from '../src/db/debates';
import type { StepJob } from '../src/debates/start';
import worker from '../src/index';
import { newDebate, sampleSetup } from './helpers';

async function deliver(job: StepJob, attempts: number) {
  const batch = createMessageBatch<StepJob>('debate-steps', [
    { id: `msg-${crypto.randomUUID()}`, timestamp: new Date(), attempts, body: job },
  ]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return { result: await getQueueResult(batch, ctx), id: batch.messages[0]!.id };
}

test('a successful step is acked and writes a Turn', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const { result, id } = await deliver({ debateId: d.id }, 1);
  expect(result.explicitAcks).toContain(id);
  expect((await getDebate(env.DB, d.id))?.turns).toHaveLength(1);
});

test('a first failure is retried, the second fails the Debate', async () => {
  // The engine refuses to generate a human Debater's Turn, so every attempt throws.
  const d = newDebate({ setup: { ...sampleSetup, debaters: { ...sampleSetup.debaters, for: { kind: 'human', memberId: 'h1' } } } });
  await createDebate(env.DB, d);

  const first = await deliver({ debateId: d.id }, 1);
  expect(first.result.retryMessages.map(m => m.msgId)).toContain(first.id);
  expect((await getDebate(env.DB, d.id))?.status).toBe('running');

  const second = await deliver({ debateId: d.id }, 2);
  expect(second.result.explicitAcks).toContain(second.id);
  expect(await getDebate(env.DB, d.id)).toMatchObject({ status: 'failed' });
});
