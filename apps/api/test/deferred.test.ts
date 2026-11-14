import { MAX_ATTEMPTS, type ModelRequest, type ModelResponse } from '@debate-arena/engine';
import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { BatchCallFailedError, BatchPendingError, type BatchApi, type BatchStatus } from '../src/models/batch';
import { deferredClient } from '../src/models/deferred';
import { BudgetExhaustedError } from '../src/models/factory';
import { OpenRouterError } from '../src/models/openrouter';
import { uniqueId } from './helpers';

/** A Batch API under test control: each submission waits until `finish` or `fail` is called for it. */
function controlledApi() {
  const submitted: ModelRequest[] = [];
  const states = new Map<string, BatchStatus | Error>();
  const api: BatchApi = {
    async submit(request) {
      submitted.push(request);
      // Lets concurrent runs interleave here, as a real network call would.
      await new Promise(resolve => setTimeout(resolve, 5));
      const id = `b${submitted.length}`;
      states.set(id, { status: 'pending' });
      return id;
    },
    async get(id) {
      const state = states.get(id) ?? { status: 'failed', reason: 'unknown' };
      if (state instanceof Error) throw state;
      return state;
    },
  };
  const finish = (id: string, text = `answer ${id}`) =>
    states.set(id, { status: 'completed', response: { text, inputTokens: 10, outputTokens: 2, finishReason: 'stop' } });
  const fail = (id: string, usage?: { inputTokens: number; outputTokens: number }) =>
    states.set(id, { status: 'failed', reason: 'expired', ...(usage ? { usage } : {}) });
  const breakLookup = (id: string, error: Error) => states.set(id, error);
  return { api, submitted, finish, fail, breakLookup };
}

const request = (content = 'Argue for.'): ModelRequest => ({ model: 'a/x', messages: [{ role: 'user', content }], maxOutputTokens: 50 });
const prices = { 'a/x': { inputPerMTokUsd: 1, outputPerMTokUsd: 1 } };

function client(api: BatchApi, debateId = uniqueId('d'), guard = async () => {}) {
  const costs: number[] = [];
  const c = deferredClient({ db: env.DB, debateId, api, prices, onCost: async n => void costs.push(n), guard });
  return { client: c, costs, debateId };
}

/** A fresh client per step run, as the consumer builds one per message. */
const rerun = (api: BatchApi, debateId: string) => client(api, debateId).client;

test('a first call submits a batch and waits', async () => {
  const { api, submitted } = controlledApi();
  await expect(client(api).client.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toEqual([request()]);
});

test('a pending call is not resubmitted', async () => {
  const { api, submitted } = controlledApi();
  const debateId = uniqueId('d');
  for (let i = 0; i < 3; i++) await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toHaveLength(1);
});

test('a completed call is charged once however often the step re-runs', async () => {
  const { api, finish } = controlledApi();
  const { client: first, costs, debateId } = client(api);
  await expect(first.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  finish('b1', 'My argument.');
  const charged: number[] = [];
  let response: ModelResponse | undefined;
  for (let i = 0; i < 3; i++) {
    const c = deferredClient({ db: env.DB, debateId, api, prices, onCost: async n => void charged.push(n), guard: async () => {} });
    response = await c.complete(request());
  }
  expect(response?.text).toBe('My argument.');
  expect([...costs, ...charged]).toEqual([12]);
});

test('the same request twice in one step is two calls', async () => {
  const { api, submitted, finish } = controlledApi();
  const { client: c, debateId } = client(api);
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  finish('b1', 'unreadable');
  const second = rerun(api, debateId);
  expect((await second.complete(request())).text).toBe('unreadable');
  // The engine retries the identical request after an unreadable reply: that is a new call, not the cached one.
  await expect(second.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toHaveLength(2);
  finish('b2', 'for');
  const third = rerun(api, debateId);
  expect((await third.complete(request())).text).toBe('unreadable');
  expect((await third.complete(request())).text).toBe('for');
});

test('a failed batch call is submitted again, then fails for good after MAX_ATTEMPTS', async () => {
  const { api, submitted, fail } = controlledApi();
  const debateId = uniqueId('d');
  await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    fail(`b${attempt}`);
    // The failure is noted and the call waits to be submitted again.
    await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
    await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
    expect(submitted).toHaveLength(attempt + 1);
  }
  fail(`b${MAX_ATTEMPTS}`);
  await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchCallFailedError);
  await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchCallFailedError);
  expect(submitted).toHaveLength(MAX_ATTEMPTS);
});

test('a failed result that used tokens is still charged', async () => {
  const { api, fail } = controlledApi();
  const { client: c, costs, debateId } = client(api);
  await expect(c.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  fail('b1', { inputTokens: 30, outputTokens: 5 });
  const charged: number[] = [];
  const again = deferredClient({ db: env.DB, debateId, api, prices, onCost: async n => void charged.push(n), guard: async () => {} });
  await expect(again.complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect([...costs, ...charged]).toEqual([35]);
});

test.each([
  ['a 5xx', new OpenRouterError('OpenRouter batch 502: bad gateway', 502)],
  ['a 429', new OpenRouterError('OpenRouter batch 429: slow down', 429)],
  ['a network error', new TypeError('fetch failed')],
])('%s while checking a batch is waiting, not failure', async (_, error) => {
  const { api, breakLookup, submitted } = controlledApi();
  const debateId = uniqueId('d');
  await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  breakLookup('b1', error);
  for (let i = 0; i < 3; i++) await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  expect(submitted).toHaveLength(1);
});

test('two runs racing on the same call submit one batch', async () => {
  const { api, submitted } = controlledApi();
  const debateId = uniqueId('d');
  const results = await Promise.allSettled([rerun(api, debateId).complete(request()), rerun(api, debateId).complete(request())]);
  expect(results.every(r => r.status === 'rejected' && r.reason instanceof BatchPendingError)).toBe(true);
  expect(submitted).toHaveLength(1);
});

test('forgetting a run discards its completed calls, so a retried step asks again', async () => {
  const { api, submitted, finish } = controlledApi();
  const debateId = uniqueId('d');
  await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
  finish('b1', '');
  const run = rerun(api, debateId);
  expect((await run.complete(request())).text).toBe('');
  // The engine rejected the empty reply; the step is retried with a fresh call.
  await run.forget();
  await expect(rerun(api, debateId).complete(request())).rejects.toBeInstanceOf(BatchPendingError);
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
