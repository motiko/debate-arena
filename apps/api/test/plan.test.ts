import { quotaPointsFor, worstCaseBudgetMicroUsd } from '@debate-arena/engine';
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import type { AiAudienceResult, Verdict } from '@debate-arena/engine';
import { completeDebate, createDebate, getDebate, saveVerdict } from '../src/db/debates';
import { DAILY_QUOTA_POINTS, quotaRemaining } from '../src/db/quota';
import { planDebate, startDebate, type StartDeps, type StepJob } from '../src/debates/start';
import { FAKE_CATALOG, priceTable, type Catalog } from '../src/models/catalog';
import { newDebate, uniqueId } from './helpers';

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
  // Fake models at $1 per million tokens: 49 634 micro-USD, 4 points.
  expect(r.budgetReservedMicroUsd).toBe(50_834);
  expect(stored?.quotaPoints).toBe(quotaPointsFor(r.budgetReservedMicroUsd));
  expect(stored?.quotaPoints).toBe(5);
  expect(await quotaRemaining(env.DB, member, now)).toBe(19);
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
    error: 'This line-up needs 31 Quota points; a day has 24. Choose cheaper models or fewer AI Voters.',
  });
  expect(await quotaRemaining(env.DB, member, now)).toBe(24);
  const r = await startDebate(deps({ unlimitedQuota: true }), member, pricey);
  if (!r.ok) throw new Error(r.error);
  expect((await getDebate(env.DB, r.id))?.quotaPoints).toBe(0);
});

test('aiVoters as a count picks that many AI Voters', () => {
  const count = (aiVoters: unknown) => {
    const r = plan({ ...valid, aiVoters });
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  expect(count(3).aiVoters).toHaveLength(3);
  expect(count(true).aiVoters).toHaveLength(10);
  for (const none of [0, false]) {
    expect(count(none).aiVoters).toEqual([]);
    expect(count(none).aiVotersMicroUsd).toBe(0);
  }
});

test('aiVotersMicroUsd is what the AI Voters add to the Budget', () => {
  const r = plan({ ...valid, aiVoters: 4 });
  if (!r.ok) throw new Error(r.error);
  const prices = priceTable(CATALOG);
  const screener = 'fake-guard/one';
  expect(r.aiVotersMicroUsd).toBe(
    worstCaseBudgetMicroUsd(r.setup, r.aiVoters, prices, screener) - worstCaseBudgetMicroUsd(r.setup, [], prices, screener),
  );
  expect(r.aiVotersMicroUsd).toBeGreaterThan(0);
});

test('an AI Voter count out of range or not whole is refused, for every Member', async () => {
  const error = 'aiVoters must be true, false or a whole number from 0 to 100';
  for (const aiVoters of [5000, 101, -1, 2.5, '10']) {
    expect(plan({ ...valid, aiVoters })).toEqual({ ok: false, status: 400, error });
  }
  const member = uniqueId('m');
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM debates').first<{ n: number }>();
  expect(await startDebate(deps({ unlimitedQuota: true }), member, { ...valid, aiVoters: 5000 })).toEqual({ ok: false, status: 400, error });
  const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM debates').first<{ n: number }>();
  expect(after?.n).toBe(before?.n);
  const quoted = await exports.default.fetch('https://api.test/api/debates/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': member },
    body: JSON.stringify({ ...valid, aiVoters: 101 }),
  });
  expect(quoted.status).toBe(400);
  expect(await quoted.json()).toEqual({ error });
});

test('the quote reports what the AI Voters add', async () => {
  const quote = async (aiVoters: unknown) => {
    const res = await exports.default.fetch('https://api.test/api/debates/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-member': uniqueId('m') },
      body: JSON.stringify({ ...valid, aiVoters }),
    });
    return ((await res.json()) as { aiVotersMicroUsd: number }).aiVotersMicroUsd;
  };
  expect(await quote(2)).toBeGreaterThan(0);
  expect(await quote(false)).toBe(0);
});

test('a stored AI Audience Result without votes is served with votes: []', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const old = { counted: 0, swing: { for: 0, against: 0 }, winner: 'tie', dropped: [] } as unknown as AiAudienceResult;
  await completeDebate(env.DB, d.id, old, new Date().toISOString());
  const res = await exports.default.fetch(`https://api.test/api/debates/${d.id}`);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { aiAudience: { votes: unknown } }).aiAudience.votes).toEqual([]);
});

test("a Debate's view includes its Format's Rubric", async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const res = await exports.default.fetch(`https://api.test/api/debates/${d.id}`);
  const body = (await res.json()) as { format: { rubric: { criteria: { name: string; description: string }[] } } };
  expect(body.format.rubric.criteria.map(c => c.name)).toEqual(['Argument strength', 'Rebuttal quality', 'Evidence', 'Clarity']);
});

test('a Verdict stored without scores is served with scores: []', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const old = { winner: 'for', reasoning: 'r', judges: ['x/y'] } as unknown as Verdict;
  await saveVerdict(env.DB, d.id, old);
  const res = await exports.default.fetch(`https://api.test/api/debates/${d.id}`);
  expect(((await res.json()) as { verdict: { scores: unknown } }).verdict.scores).toEqual([]);
});

test('a Verdict stored before ADR 0008 is served with no confidence, crux, claims or Ballots', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  await saveVerdict(env.DB, d.id, { winner: 'for', reasoning: 'r', scores: [], judges: ['x/y'] } as unknown as Verdict);
  const res = await exports.default.fetch(`https://api.test/api/debates/${d.id}`);
  expect(((await res.json()) as { verdict: unknown }).verdict).toMatchObject({ confidence: null, crux: '', claims: [], ballots: [] });
});

test('panel: 3 asks for three suggested Judges from three families', () => {
  expect(plan({ ...valid, debaters: { for: 'custom', against: 'custom' } })).toMatchObject({ setup: { panel: ['fake-a/one'] } });
  const r = plan({ ...valid, debaters: { for: 'custom', against: 'custom' }, panel: 3 });
  if (!r.ok) throw new Error(r.error);
  expect(r.setup.panel).toEqual(['fake-a/one', 'fake-b/one', 'fake-c/one']);
  expect(r.quotaPoints).toBeLessThanOrEqual(DAILY_QUOTA_POINTS);
});

test('a chosen Panel holds one or three distinct Judges', () => {
  expect(plan({ ...valid, panel: ['fake-c/one', 'fake-d/one', 'fake-a/one'] }).ok).toBe(true);
  expect(plan({ ...valid, panel: ['fake-c/one', 'fake-d/one'] })).toMatchObject({ ok: false, error: 'A Panel must hold one or three Judges' });
  expect(plan({ ...valid, panel: ['fake-c/one', 'fake-c/one', 'fake-d/one'] })).toMatchObject({ ok: false, error: 'A Panel must not seat the same Judge twice' });
  expect(plan({ ...valid, panel: 2 })).toMatchObject({ ok: false, error: 'panel must be a list of model ids, 1 or 3' });
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
  expect(r.budgetReservedMicroUsd).toBe(worstCaseBudgetMicroUsd(stored!.setup, [], priceTable(CATALOG), 'fake-guard/one', 'fake-label/one'));
});

test('both benches may be API Debaters', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, debaters: { for: 'api', against: 'api' } });
  expect(r).toMatchObject({ ok: true });
});

test('a Slow Debate cannot have a Custom Debater', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, debaters: { for: 'api', against: 'fake-b/one' }, batch: true });
  expect(r).toEqual({ ok: false, status: 400, error: 'A Slow Debate cannot have a Custom Debater' });
});

test('a Custom Debater may be named at start', async () => {
  const r = plan({ ...valid, debaters: { for: { kind: 'custom', name: ' Atlas ', model: 'gpt-6' }, against: 'fake-b/one' } });
  if (!r.ok) throw new Error(r.error);
  expect(r.setup.debaters.for).toEqual({ kind: 'api', name: 'Atlas', model: 'gpt-6' });
});

test('"custom" seats a Custom Debater', () => {
  const r = plan({ ...valid, debaters: { for: 'custom', against: { kind: 'api' } } });
  if (!r.ok) throw new Error(r.error);
  expect(r.setup.debaters).toEqual({ for: { kind: 'api' }, against: { kind: 'api' } });
});

test('a bad Custom Debater name is refused', () => {
  expect(plan({ ...valid, debaters: { for: { kind: 'custom', name: 'x'.repeat(41) }, against: 'fake-b/one' } })).toEqual({
    ok: false,
    status: 400,
    error: 'Custom Debater name must be 1–40 characters: letters, digits, spaces and simple punctuation',
  });
});

test('an object seat must be a Custom one', () => {
  expect(plan({ ...valid, debaters: { for: { kind: 'ai', model: 'fake-a/one' }, against: 'fake-b/one' } })).toMatchObject({
    ok: false,
    status: 400,
    error: expect.stringContaining('debaters must name a model (or "custom")'),
  });
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

test('the suggested Judge comes from the suggested Judges, in their order, when the catalog marks any', () => {
  const marked: Catalog = {
    entries: [
      ...FAKE_CATALOG.entries.map(e => ({ ...e, curated: true as const })),
      ...['fake-d/one', 'fake-c/one'].map(id => ({ ...FAKE_CATALOG.entries.find(e => e.id === id)!, curated: true as const, suggestedJudge: true as const })),
    ].filter((e, i, all) => all.findLastIndex(x => x.id === e.id) === i),
  };
  const r = planDebate({ catalog: marked }, valid);
  if (!r.ok) throw new Error(r.error);
  expect(r.setup.panel).toEqual(['fake-d/one']);
});

test('the Debate freezes the price and reasoning of every model it will call', async () => {
  const r = await startDebate(deps(), uniqueId('m'), { ...valid, panel: ['fake-e/thinker'], aiVoters: true });
  if (!r.ok) throw new Error(r.error);
  const stored = await getDebate(env.DB, r.id);
  const ids = Object.keys(stored!.models!).toSorted();
  expect(ids).toEqual([...new Set(['fake-a/one', 'fake-b/one', 'fake-e/thinker', 'fake-guard/one', 'fake-label/one', ...stored!.aiVoters])].toSorted());
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
    budgetMicroUsd: 50_834,
    quotaPoints: 5,
    quotaRemaining: 24,
    slowAvailable: true,
    panel: ['fake-c/one'],
    selfJudging: false,
    aiVotersMicroUsd: 0,
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
