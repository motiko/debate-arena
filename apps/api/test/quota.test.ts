import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { quotaRemaining, refundQuota, spendQuota, utcDay } from '../src/db/quota';
import { uniqueId } from './helpers';

const noon = new Date('2026-11-13T12:00:00Z');

test('utcDay uses the UTC calendar day', () => {
  expect(utcDay(new Date('2026-11-13T23:59:59Z'))).toBe('2026-11-13');
  expect(utcDay('2026-11-14T00:00:00.000Z')).toBe('2026-11-14');
});

test('a day holds 24 points: three 8-point Debates fit, the fourth does not', async () => {
  const m = uniqueId('m');
  for (let i = 0; i < 3; i++) expect(await spendQuota(env.DB, m, 8, noon)).toBe(true);
  expect(await spendQuota(env.DB, m, 8, noon)).toBe(false);
  expect(await quotaRemaining(env.DB, m, noon)).toBe(0);
});

test('the day rolls over at UTC midnight', async () => {
  const m = uniqueId('m');
  expect(await spendQuota(env.DB, m, 24, new Date('2026-11-13T23:59:00Z'))).toBe(true);
  expect(await spendQuota(env.DB, m, 4, new Date('2026-11-14T00:00:00Z'))).toBe(true);
});

test('Members have separate Quotas', async () => {
  const [m1, m2] = [uniqueId('m'), uniqueId('m')];
  expect(await spendQuota(env.DB, m1, 24, noon)).toBe(true);
  expect(await spendQuota(env.DB, m2, 4, noon)).toBe(true);
});

test('a spend larger than the whole Quota is refused', async () => {
  expect(await spendQuota(env.DB, uniqueId('m'), 25, noon)).toBe(false);
});

test('refunds restore points for that day, never below zero', async () => {
  const m = uniqueId('m');
  await spendQuota(env.DB, m, 24, noon);
  await refundQuota(env.DB, m, 8, '2026-11-13');
  expect(await quotaRemaining(env.DB, m, noon)).toBe(8);
  await refundQuota(env.DB, m, 40, '2026-11-13');
  expect(await quotaRemaining(env.DB, m, noon)).toBe(24);
});

test('concurrent spends never exceed the Quota', async () => {
  const m = uniqueId('m');
  const results = await Promise.all(Array.from({ length: 5 }, () => spendQuota(env.DB, m, 8, noon)));
  expect(results.filter(Boolean)).toHaveLength(3);
});
