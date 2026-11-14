import type { ModelRequest, ModelResponse } from '@debate-arena/engine';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { BatchPendingError, type BatchApi, type BatchStatus } from '../src/models/batch';
import { deferredClient } from '../src/models/deferred';
import { BudgetExhaustedError } from '../src/models/factory';
import { uniqueId } from './helpers';

/** A Batch API under test control: each submission waits until `finish` is called for it. */
function controlledApi() {
  const submitted: ModelRequest[] = [];
  const states = new Map<string, BatchStatus>();
  const api: BatchApi = {
    async submit(request) {
      submitted.push(request);
      const id = `b${submitted.length}`;
      states.set(id, { status: 'pending' });
      return id;
    },
    async get(id) {
      return states.get(id) ?? { status: 'failed', reason: 'unknown' };
    },
  };
  const finish = (id: string, text = `answer ${id}`) =>
    states.set(id, { status: 'completed', response: { text, inputTokens: 10, outputTokens: 2, finishReason: 'stop' } });
  const fail = (id: string) => states.set(id, { status: 'failed', reason: 'expired' });
  return { api, submitted, finish, fail };
}

const request = (content = 'Argue for.'): ModelRequest => ({ model: 'a/x', messages: [{ role: 'user', content }], maxOutputTokens: 50 });
const prices = { 'a/x': { inputPerMTokUsd: 1, outputPerMTokUsd: 1 } };

function client(api: BatchApi, debateId = uniqueId('d'), guard = async () => {}) {
  const costs: number[] = [];
  const c = deferredClient({ db: env.DB, debateId, api, prices, onCost: async n => void costs.push(n), guard });
  return { client: c, costs, debateId };
}

test('a first call submits a batch and waits', async () => {
  const { api, submitted } = controlledApi();
  const { client: c } = client(api);
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toEqual([request()]);
});

test('a pending call is not resubmitted', async () => {
  const { api, submitted } = controlledApi();
  const { client: c } = client(api);
  for (let i = 0; i < 3; i++) {
    c.reset();
    await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  }
  expect(submitted).toHaveLength(1);
});

test('a completed call is charged once however often the step re-runs', async () => {
  const { api, finish } = controlledApi();
  const { client: c, costs } = client(api);
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  finish('b1', 'My argument.');
  let response: ModelResponse | undefined;
  for (let i = 0; i < 3; i++) {
    c.reset();
    response = await c.complete(request());
  }
  expect(response?.text).toBe('My argument.');
  expect(costs).toEqual([12]);
});

test('the same request twice in one step is two calls', async () => {
  const { api, submitted, finish } = controlledApi();
  const { client: c } = client(api);
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  finish('b1', 'unreadable');
  c.reset();
  expect((await c.complete(request())).text).toBe('unreadable');
  // The engine retries the identical request after an unreadable reply: that is a new call, not the cached one.
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toHaveLength(2);
  finish('b2', 'for');
  c.reset();
  expect((await c.complete(request())).text).toBe('unreadable');
  expect((await c.complete(request())).text).toBe('for');
});

test('a failed batch call is resubmitted on the next attempt', async () => {
  const { api, submitted, fail } = controlledApi();
  const { client: c } = client(api);
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  fail('b1');
  c.reset();
  await expect(c.complete(request())).rejects.toThrow(/Batch call failed/);
  c.reset();
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toHaveLength(2);
});

test('the Budget guard stops new submissions', async () => {
  const { api, submitted } = controlledApi();
  const { client: c } = client(api, uniqueId('d'), async () => {
    throw new BudgetExhaustedError('spent');
  });
  await expect(c.complete(request())).rejects.toBeInstanceOf(BudgetExhaustedError);
  expect(submitted).toHaveLength(0);
});

test('calls are kept per Debate', async () => {
  const { api, submitted } = controlledApi();
  await expect(client(api).client.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  await expect(client(api).client.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toHaveLength(2);
});
