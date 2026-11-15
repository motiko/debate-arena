import { expect, test } from 'vitest';
import { wordsToTokens } from '../debate/schedule';
import { UnknownModelPriceError } from '../errors';
import { setup } from '../testing/fixtures';
import { apiTurnMaxBytes, IDENTITY_MAX_BYTES, type PriceTable, quotaPointsFor, utf8Length, worstCaseBudgetMicroUsd } from './estimate';

// Every model at 1 USD per million tokens in and out, so micro-USD equals tokens.
const unit = { inputPerMTokUsd: 1, outputPerMTokUsd: 1 };
const unitPrices: PriceTable = { 'a/for-model': unit, 'b/against-model': unit, 'c/judge': unit, 'x/v': unit };

test('word-to-token conversion is not thrown off by floating point', () => {
  expect(wordsToTokens(10)).toBe(14); // 10 * 1.4 === 14.000000000000002 in JS
  expect(wordsToTokens(5)).toBe(7);
  expect(wordsToTokens(3)).toBe(5);
});

test('UTF-8 length bounds tokens for any script', () => {
  expect(utf8Length('Remote work beats office work')).toBe(29);
  expect(utf8Length('猫')).toBe(3);
  expect(utf8Length('😀')).toBe(4);
});

// Motion "Remote work beats office work" = 29 bytes, so every call reads 600 + 29 = 629 tokens of base.
// Output caps (2x headroom): 840, 840, 560, 560, 420, 420 (sum 3640).
// One attempt: Turns 14554 in + 3640 out, Judge 4269 in + 800 out = 23263. Every call is reserved twice.
test('Classic Debate with one Judge', () => {
  expect(worstCaseBudgetMicroUsd(setup, [], unitPrices)).toBe(46526);
});

test('each AI Voter adds a before- and after-stance', () => {
  // (629 + 10) + (4269 + 10) = 4918 per attempt, twice
  expect(worstCaseBudgetMicroUsd(setup, ['x/v'], unitPrices)).toBe(46526 + 9836);
});

test('budget covers screening the Motion', () => {
  // (629 Motion prompt + 16 output) per attempt, twice
  expect(worstCaseBudgetMicroUsd(setup, [], { ...unitPrices, 'g/guard': unit }, 'g/guard')).toBe(46526 + 1290);
});

test('human Debaters cost nothing', () => {
  const humanFor = { ...setup, debaters: { ...setup.debaters, for: { kind: 'human', memberId: 'm1' } as const } };
  // Drops the three For Turns: (629+840) + (2309+560) + (3429+420) = 8187, twice
  expect(worstCaseBudgetMicroUsd(humanFor, [], unitPrices)).toBe(46526 - 16374);
});

test('an API Debater costs no model calls, one screen per Turn, and its Turns are read at their byte cap', () => {
  const apiFor = { ...setup, debaters: { ...setup.debaters, for: { kind: 'api' } as const } };
  const prices = { ...unitPrices, 'g/guard': unit };
  // AI Debate with the Motion screen: 46526 + 1290. Drops the For Turns (16374). An API Turn is at most
  // 8 bytes per word (2400, 1600, 1200), and bytes bound tokens. Screens: (629+2400+16) + (629+1600+16) + (629+1200+16)
  // = 7135, twice. Later calls read the larger For Turns: Against 2 reads +1560, Against 4 +2600, Against 6 and the
  // Judge +3380 each = 10920, twice. The identity screen: (629+416+16), twice = 2122.
  expect(worstCaseBudgetMicroUsd(apiFor, [], prices, 'g/guard')).toBe(46526 + 1290 - 16374 + 14270 + 21840 + 2122);
});

test('an identity is read at its byte cap: 4 bytes per character of the longest name and model, plus labels', () => {
  expect(IDENTITY_MAX_BYTES).toBe(4 * (40 + 60) + 16);
});

test('apiTurnMaxBytes is 8 bytes per word of the Phase', () => {
  expect(apiTurnMaxBytes(300)).toBe(2400);
});

test('extraOutputTokens is charged on every call of that model', () => {
  const plain = worstCaseBudgetMicroUsd(setup, [], unitPrices);
  const reasoning = worstCaseBudgetMicroUsd(setup, [], { ...unitPrices, 'c/judge': { ...unit, extraOutputTokens: 2048 } });
  expect(reasoning - plain).toBe(2 * 2048);
});

test('an invalid reasoning allowance is an error, never a smaller Budget', () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const prices = { ...unitPrices, 'c/judge': { ...unit, extraOutputTokens: bad } };
    expect(() => worstCaseBudgetMicroUsd(setup, [], prices)).toThrow(UnknownModelPriceError);
  }
});

test('quotaPointsFor refuses a Budget that is not a finite number', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(() => quotaPointsFor(bad)).toThrow(RangeError);
});

test('quotaPointsFor: one point per 1.25 cents, rounded up, at least 1', () => {
  expect(quotaPointsFor(0)).toBe(1);
  expect(quotaPointsFor(12_500)).toBe(1);
  expect(quotaPointsFor(12_501)).toBe(2);
  expect(quotaPointsFor(300_000)).toBe(24);
});

test('prices scale cost', () => {
  const double = Object.fromEntries(Object.keys(unitPrices).map(k => [k, { inputPerMTokUsd: 2, outputPerMTokUsd: 2 }]));
  expect(worstCaseBudgetMicroUsd(setup, [], double)).toBe(93052);
});

test('a long Motion without spaces is costed by its length, not its word count', () => {
  const short = worstCaseBudgetMicroUsd({ ...setup, motion: { text: 'x' } }, [], unitPrices);
  const long = worstCaseBudgetMicroUsd({ ...setup, motion: { text: 'x'.repeat(3000) } }, [], unitPrices);
  // 2999 extra bytes read by 7 calls (6 Turns + Judge), each reserved twice
  expect(long - short).toBe(2999 * 14);
});

test('unknown model prices are an error', () => {
  expect(() => worstCaseBudgetMicroUsd(setup, [], {})).toThrow(UnknownModelPriceError);
});

test('inherited object keys are not prices', () => {
  expect(() => worstCaseBudgetMicroUsd({ ...setup, panel: ['constructor'] }, [], unitPrices)).toThrow(UnknownModelPriceError);
});

test('invalid prices are an error, never NaN', () => {
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const prices = { ...unitPrices, 'c/judge': { inputPerMTokUsd: bad, outputPerMTokUsd: 1 } };
    expect(() => worstCaseBudgetMicroUsd(setup, [], prices)).toThrow(UnknownModelPriceError);
  }
});
