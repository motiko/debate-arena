import { worstCaseBudgetMicroUsd } from '@debate-arena/engine';
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { getDebate } from '../src/db/debates';
import { quotaRemaining } from '../src/db/quota';
import { startDebate, type StartDeps, type StepJob } from '../src/debates/start';
import { catalogFor, FAKE_CATALOG, isBatchCapable, priceTable, PRODUCTION_CATALOG, screenerFor } from '../src/models/catalog';
import { uniqueId } from './helpers';

const now = new Date('2026-11-14T12:00:00Z');

function makeDeps(): StartDeps {
  const jobs: StepJob[] = [];
  return {
    db: env.DB,
    catalog: FAKE_CATALOG,
    enqueue: async job => {
      jobs.push(job);
    },
    now: () => now,
    newId: () => uniqueId('debate'),
  };
}

const valid = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false };
const batch = { ...valid, batch: true };

test('batch-capable models are marked and priced at their batch price', () => {
  expect(isBatchCapable(PRODUCTION_CATALOG, 'anthropic/claude-haiku-5.5')).toBe(true);
  expect(isBatchCapable(PRODUCTION_CATALOG, 'google/gemini-3.8-flash')).toBe(true);
  expect(isBatchCapable(PRODUCTION_CATALOG, 'mistralai/mistral-large-4-0')).toBe(false);
  expect(isBatchCapable(FAKE_CATALOG, 'fake-slow/one')).toBe(false);
  const batchCatalog = catalogFor(PRODUCTION_CATALOG, 'batch');
  expect(priceTable(batchCatalog)['anthropic/claude-haiku-5.5']).toEqual({ inputPerMTokUsd: 0.05, outputPerMTokUsd: 0.25 });
  expect(batchCatalog.entries.map(e => e.id)).not.toContain('mistralai/mistral-large-4-0');
  // The screener has no batch variant; it stays, at its normal price.
  expect(screenerFor(batchCatalog)).toBe('meta-llama/llama-guard-4-12b');
  expect(catalogFor(PRODUCTION_CATALOG, 'live')).toBe(PRODUCTION_CATALOG);
});

test('a Batch Debate costs one Quota point', async () => {
  const member = uniqueId('m');
  for (let i = 0; i < 2; i++) expect((await startDebate(makeDeps(), member, valid)).ok).toBe(true);
  for (let i = 0; i < 2; i++) expect((await startDebate(makeDeps(), member, batch)).ok).toBe(true);
  expect(await quotaRemaining(env.DB, member, now)).toBe(0);
  const solo = uniqueId('m');
  for (let i = 0; i < 6; i++) expect((await startDebate(makeDeps(), solo, batch)).ok).toBe(true);
  expect((await startDebate(makeDeps(), solo, batch)).ok).toBe(false);
});

test('a Batch Debate is stored as one', async () => {
  const r = await startDebate(makeDeps(), uniqueId('m'), batch);
  if (!r.ok) throw new Error(r.error);
  expect(await getDebate(env.DB, r.id)).toMatchObject({ kind: 'batch', quotaPoints: 1 });
  const live = await startDebate(makeDeps(), uniqueId('m'), valid);
  if (!live.ok) throw new Error(live.error);
  expect(await getDebate(env.DB, live.id)).toMatchObject({ kind: 'live', quotaPoints: 2 });
});

test('a Batch Debate refuses a model without batch', async () => {
  const r = await startDebate(makeDeps(), uniqueId('m'), { ...batch, debaters: { for: 'fake-slow/one', against: 'fake-b/one' } });
  expect(r).toEqual({ ok: false, status: 400, error: 'Model fake-slow/one has no batch processing' });
});

test("a Batch Debate's Panel and AI Voters are batch-capable", async () => {
  const r = await startDebate(makeDeps(), uniqueId('m'), { ...batch, aiVoters: true });
  if (!r.ok) throw new Error(r.error);
  const stored = await getDebate(env.DB, r.id);
  for (const id of [...stored!.setup.panel, ...stored!.aiVoters]) expect(isBatchCapable(FAKE_CATALOG, id)).toBe(true);
  expect(stored!.aiVoters).toHaveLength(10);
});

test("a Batch Debate reserves its Budget at batch prices", async () => {
  const r = await startDebate(makeDeps(), uniqueId('m'), batch);
  const live = await startDebate(makeDeps(), uniqueId('m'), valid);
  if (!r.ok || !live.ok) throw new Error('start failed');
  const setup = (await getDebate(env.DB, r.id))!.setup;
  expect(r.budgetReservedMicroUsd).toBe(worstCaseBudgetMicroUsd(setup, [], priceTable(catalogFor(FAKE_CATALOG, 'batch')), 'fake-guard/one'));
  expect(r.budgetReservedMicroUsd).toBeLessThan(live.budgetReservedMicroUsd);
});

test('/api/models marks batch-capable models', async () => {
  const { models } = (await (await exports.default.fetch('https://api.test/api/models')).json()) as { models: { id: string; batch: boolean }[] };
  expect(models.find(m => m.id === 'fake-a/one')?.batch).toBe(true);
  expect(models.find(m => m.id === 'fake-slow/one')?.batch).toBe(false);
});
