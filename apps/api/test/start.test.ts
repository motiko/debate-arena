import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { getDebate } from '../src/db/debates';
import { quotaRemaining } from '../src/db/quota';
import { startDebate, type StartDeps, type StepJob } from '../src/debates/start';
import { worstCaseBudgetMicroUsd } from '@debate-arena/engine';
import { FAKE_CATALOG, priceTable } from '../src/models/catalog';
import { uniqueId } from './helpers';

const now = new Date('2026-11-13T12:00:00Z');

function makeDeps(overrides: Partial<StartDeps> = {}) {
  const jobs: StepJob[] = [];
  const deps: StartDeps = {
    db: env.DB,
    catalog: FAKE_CATALOG,
    enqueue: async job => {
      jobs.push(job);
    },
    now: () => now,
    newId: () => uniqueId('debate'),
    ...overrides,
  };
  return { deps, jobs };
}

const valid = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false };

test('starts a Debate: suggested Panel, Budget reserved, Quota spent, one job queued', async () => {
  const { deps, jobs } = makeDeps();
  const member = uniqueId('m');
  const r = await startDebate(deps, member, valid);
  if (!r.ok) throw new Error(r.error);
  expect(r.panel).toEqual(['fake-c/one']);
  expect(r.selfJudging).toBe(false);
  expect(jobs).toEqual([{ debateId: r.id }]);
  expect(await quotaRemaining(env.DB, member, now)).toBe(20);
  const stored = await getDebate(env.DB, r.id);
  expect(stored).toMatchObject({ memberId: member, status: 'running', quotaPoints: 4, aiVoters: [] });
  expect(stored?.budgetReservedMicroUsd).toBe(r.budgetReservedMicroUsd);
  expect(r.budgetReservedMicroUsd).toBeGreaterThan(0);
});

test.each([[''], ['   '], ['x'.repeat(301)]])('rejects the Motion %j', async motion => {
  const r = await startDebate(makeDeps().deps, uniqueId('m'), { ...valid, motion });
  expect(r).toEqual({ ok: false, status: 400, error: 'Motion must be 1–300 characters' });
});

test('trims the Motion before storing it', async () => {
  const r = await startDebate(makeDeps().deps, uniqueId('m'), { ...valid, motion: '  Cats beat dogs  ' });
  if (!r.ok) throw new Error(r.error);
  expect((await getDebate(env.DB, r.id))?.setup.motion.text).toBe('Cats beat dogs');
});

test.each([[null], ['text'], [{ motion: 'm' }], [{ ...valid, debaters: { for: 1, against: 'fake-b/one' } }], [{ ...valid, aiVoters: 'yes' }]])(
  'rejects a malformed request %j',
  async input => {
    const r = await startDebate(makeDeps().deps, uniqueId('m'), input);
    expect(r).toMatchObject({ ok: false, status: 400 });
  },
);

test('rejects models outside the catalog or role', async () => {
  const deps = makeDeps().deps;
  expect(await startDebate(deps, uniqueId('m'), { ...valid, debaters: { for: 'evil/model', against: 'fake-b/one' } })).toEqual({
    ok: false,
    status: 400,
    error: 'Model evil/model cannot be a Debater',
  });
  expect(await startDebate(deps, uniqueId('m'), { ...valid, panel: ['fake-a/debater-only'] })).toEqual({
    ok: false,
    status: 400,
    error: 'Model fake-a/debater-only cannot be a Judge',
  });
});

test('rejects a Panel of two Judges', async () => {
  const r = await startDebate(makeDeps().deps, uniqueId('m'), { ...valid, panel: ['fake-c/one', 'fake-d/one'] });
  expect(r).toEqual({ ok: false, status: 400, error: 'A Panel must hold exactly one Judge' });
});

test('an explicit same-model Judge is allowed and flagged as Self-Judging', async () => {
  const r = await startDebate(makeDeps().deps, uniqueId('m'), { ...valid, panel: ['fake-a/one'] });
  expect(r).toMatchObject({ ok: true, panel: ['fake-a/one'], selfJudging: true });
});

test('opting into AI Voters stores ten of them and raises the Budget', async () => {
  const without = await startDebate(makeDeps().deps, uniqueId('m'), valid);
  const withVoters = await startDebate(makeDeps().deps, uniqueId('m'), { ...valid, aiVoters: true });
  if (!without.ok || !withVoters.ok) throw new Error('start failed');
  expect((await getDebate(env.DB, withVoters.id))?.aiVoters).toHaveLength(10);
  expect(withVoters.budgetReservedMicroUsd).toBeGreaterThan(without.budgetReservedMicroUsd);
});

test('the Budget reserved at start covers screening the Motion', async () => {
  const r = await startDebate(makeDeps().deps, uniqueId('m'), valid);
  if (!r.ok) throw new Error('start failed');
  const stored = await getDebate(env.DB, r.id);
  const prices = priceTable(FAKE_CATALOG);
  expect(r.budgetReservedMicroUsd).toBe(worstCaseBudgetMicroUsd(stored!.setup, [], prices, 'fake-guard/one'));
  expect(r.budgetReservedMicroUsd).toBeGreaterThan(worstCaseBudgetMicroUsd(stored!.setup, [], prices));
});

test('a Debate beyond the day\'s Quota is refused with 429', async () => {
  const { deps, jobs } = makeDeps();
  const member = uniqueId('m');
  // 4 points each: six fit in 24.
  for (let i = 0; i < 6; i++) expect((await startDebate(deps, member, valid)).ok).toBe(true);
  expect(await startDebate(deps, member, valid)).toEqual({ ok: false, status: 429, error: 'Daily Debate limit reached' });
  expect(jobs).toHaveLength(6);
});

test('a failed enqueue refunds the Quota and fails the Debate', async () => {
  let id = '';
  const { deps } = makeDeps({
    newId: () => (id = uniqueId('debate')),
    enqueue: async () => {
      throw new Error('queue down');
    },
  });
  const member = uniqueId('m');
  await expect(startDebate(deps, member, valid)).rejects.toThrow('queue down');
  expect(await quotaRemaining(env.DB, member, now)).toBe(24);
  expect((await getDebate(env.DB, id))?.status).toBe('failed');
});

test('a Member with unlimited Quota starts Debates without spending any', async () => {
  const { deps } = makeDeps({ unlimitedQuota: true });
  const member = uniqueId('m');
  for (let i = 0; i < 4; i++) {
    const r = await startDebate(deps, member, valid);
    if (!r.ok) throw new Error(r.error);
    expect((await getDebate(env.DB, r.id))?.quotaPoints).toBe(0);
  }
  expect(await quotaRemaining(env.DB, member, now)).toBe(24);
});
