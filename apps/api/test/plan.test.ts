import { quotaPointsFor, worstCaseBudgetMicroUsd } from '@debate-arena/engine';
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { getDebate } from '../src/db/debates';
import { quotaRemaining } from '../src/db/quota';
import { planDebate, startDebate, type StartDeps, type StepJob } from '../src/debates/start';
import { FAKE_CATALOG, priceTable, type Catalog } from '../src/models/catalog';
import { uniqueId } from './helpers';

const now = new Date('2026-11-15T12:00:00Z');
const price = (p: number) => ({ inputPerMTokUsd: p, outputPerMTokUsd: p });

/** The fake catalog plus a costly Debater, a very costly one, a Judge without batch and a mandatory reasoner. */
const CATALOG: Catalog = {
  entries: [
    ...FAKE_CATALOG.entries,
    { id: 'fake-e/pricey', label: 'Pricey', price: price(10), roles: ['debater', 'judge'], reasoning: 'unsupported' },
    { id: 'fake-e/ruinous', label: 'Ruinous', price: price(200), roles: ['debater'], reasoning: 'unsupported' },
    { id: 'fake-e/nobatch', label: 'No batch', price: price(1), roles: ['debater', 'judge'], reasoning: 'unsupported' },
    { id: 'fake-e/thinker', label: 'Thinker', price: price(1), roles: ['debater', 'judge'], reasoning: 'mandatory', batchPrice: price(0.5) },
  ],
};

function deps(overrides: Partial<StartDeps> = {}): StartDeps {
  const jobs: StepJob[] = [];
  return {
    db: env.DB,
    catalog: CATALOG,
    enqueue: async job => {
      jobs.push(job);
    },
    now: () => now,
    newId: () => uniqueId('debate'),
    ...overrides,
  };
}

const valid = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false };
const plan = (input: unknown, unlimitedQuota = false) => planDebate({ catalog: CATALOG, unlimitedQuota }, input);

test('a Debate spends Quota points in proportion to its worst-case Budget', async () => {
  const member = uniqueId('m');
  const r = await startDebate(deps(), member, valid);
  if (!r.ok) throw new Error(r.error);
  const stored = await getDebate(env.DB, r.id);
  // Fake models at $1 per million tokens: 47 816 micro-USD, 4 points.
  expect(r.budgetReservedMicroUsd).toBe(47_816);
  expect(stored?.quotaPoints).toBe(quotaPointsFor(r.budgetReservedMicroUsd));
  expect(stored?.quotaPoints).toBe(4);
  expect(await quotaRemaining(env.DB, member, now)).toBe(20);
});

test('AI Voters and the Judge count toward the Quota points', () => {
  const withVoters = plan({ ...valid, aiVoters: true });
  const priceyJudge = plan({ ...valid, panel: ['fake-e/pricey'] });
  if (!withVoters.ok || !priceyJudge.ok) throw new Error('plan failed');
  expect(withVoters.quotaPoints).toBe(12);
  expect(priceyJudge.quotaPoints).toBeGreaterThan(4);
});

test('a line-up needing more points than a day has is refused, unless the Quota is unlimited', async () => {
  const pricey = { ...valid, debaters: { for: 'fake-e/pricey', against: 'fake-e/pricey' } };
  const member = uniqueId('m');
  expect(await startDebate(deps(), member, pricey)).toEqual({
    ok: false,
    status: 400,
    error: 'This line-up needs 31 Quota points; a day has 24. Choose cheaper models or leave out AI Voters.',
  });
  expect(await quotaRemaining(env.DB, member, now)).toBe(24);
  const r = await startDebate(deps({ unlimitedQuota: true }), member, pricey);
  if (!r.ok) throw new Error(r.error);
  expect((await getDebate(env.DB, r.id))?.quotaPoints).toBe(0);
});

test('a line-up over $5 is refused for everyone', async () => {
  const ruinous = { ...valid, debaters: { for: 'fake-e/ruinous', against: 'fake-e/ruinous' } };
  for (const unlimitedQuota of [false, true]) {
    const r = await startDebate(deps({ unlimitedQuota }), uniqueId('m'), ruinous);
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toMatch(/^This line-up could cost up to \$7\.\d\d; a Debate may reserve at most \$5\.00\.$/);
  }
});

test('an API Debater is stored as one and reserved as the engine reckons it', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, debaters: { for: 'api', against: 'fake-b/one' } });
  if (!r.ok) throw new Error(r.error);
  const stored = await getDebate(env.DB, r.id);
  expect(stored?.setup.debaters.for).toEqual({ kind: 'api' });
  expect(r.budgetReservedMicroUsd).toBe(worstCaseBudgetMicroUsd(stored!.setup, [], priceTable(CATALOG), 'fake-guard/one'));
});

test('both benches may be API Debaters', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, debaters: { for: 'api', against: 'api' } });
  expect(r).toMatchObject({ ok: true });
});

test('a Slow Debate cannot have an API Debater', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, debaters: { for: 'api', against: 'fake-b/one' }, batch: true });
  expect(r).toEqual({ ok: false, status: 400, error: 'A Slow Debate cannot have an API Debater' });
});

test("a Slow Debate refuses a Judge that is not batch-capable, or a mandatory reasoner", async () => {
  expect(plan({ ...valid, batch: true, panel: ['fake-e/nobatch'] })).toEqual({
    ok: false,
    status: 400,
    error: 'Model fake-e/nobatch cannot take part in a Slow Debate',
  });
  expect(plan({ ...valid, batch: true, debaters: { for: 'fake-e/thinker', against: 'fake-b/one' } })).toMatchObject({ ok: false, status: 400 });
});

test('slowAvailable: both Debaters batch-capable models', () => {
  const slow = (forModel: string, against = 'fake-b/one') => {
    const r = plan({ ...valid, debaters: { for: forModel, against } });
    if (!r.ok) throw new Error(r.error);
    return r.slowAvailable;
  };
  expect(slow('fake-a/one')).toBe(true);
  expect(slow('fake-slow/one')).toBe(false);
  expect(slow('fake-e/thinker')).toBe(false);
  expect(slow('api')).toBe(false);
});

test('the suggested Judge is a curated model when the catalog has curated ones', () => {
  const curated: Catalog = {
    entries: [
      { id: 'live-x/judge', label: 'Live Judge', price: price(0.1), roles: ['debater', 'judge'], reasoning: 'unsupported' },
      ...FAKE_CATALOG.entries.map(e => (e.roles.includes('judge') || e.roles.includes('screener') ? { ...e, curated: true as const } : e)),
    ],
  };
  const r = planDebate({ catalog: curated }, valid);
  if (!r.ok) throw new Error(r.error);
  expect(r.setup.panel).toEqual(['fake-c/one']);
});

test('the Debate freezes the price and reasoning of every model it will call', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, panel: ['fake-e/thinker'], aiVoters: true });
  if (!r.ok) throw new Error(r.error);
  const stored = await getDebate(env.DB, r.id);
  const ids = Object.keys(stored!.models!).toSorted();
  expect(ids).toEqual([...new Set(['fake-a/one', 'fake-b/one', 'fake-e/thinker', 'fake-guard/one', ...stored!.aiVoters])].toSorted());
  expect(stored!.models!['fake-e/thinker']).toEqual({ price: { ...price(1), extraOutputTokens: 2048 }, reasoning: 'mandatory' });
  expect(stored!.models!['fake-a/one']).toEqual({ price: price(1), reasoning: 'unsupported' });
});

test('POST /debates/quote prices a line-up without charging or creating anything', async () => {
  const member = uniqueId('m');
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM debates').first<{ n: number }>();
  const res = await exports.default.fetch('https://api.test/api/debates/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': member },
    body: JSON.stringify(valid),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    budgetMicroUsd: 47_816,
    quotaPoints: 4,
    quotaRemaining: 24,
    slowAvailable: true,
    panel: ['fake-c/one'],
    selfJudging: false,
  });
  const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM debates').first<{ n: number }>();
  expect(after?.n).toBe(before?.n);
  expect(await quotaRemaining(env.DB, member, new Date())).toBe(24);
});

test('POST /debates/quote answers a bad line-up with 400 and a signed-out caller with 401', async () => {
  const post = (body: unknown, headers: Record<string, string>) =>
    exports.default.fetch('https://api.test/api/debates/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  expect((await post(valid, {})).status).toBe(401);
  const bad = await post({ ...valid, debaters: { for: 'evil/model', against: 'fake-b/one' } }, { 'x-dev-member': uniqueId('m') });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: 'Model evil/model cannot be a Debater' });
});
