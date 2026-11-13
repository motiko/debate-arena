import { expect, test } from 'vitest';
import { wordsToTokens } from '../debate/schedule';
import { UnknownModelPriceError } from '../errors';
import { setup } from '../testing/fixtures';
import { type PriceTable, worstCaseBudgetMicroUsd } from './estimate';

// Every model at 1 USD per million tokens in and out, so micro-USD equals tokens.
const unit = { inputPerMTokUsd: 1, outputPerMTokUsd: 1 };
const unitPrices: PriceTable = { 'a/for-model': unit, 'b/against-model': unit, 'c/judge': unit, 'x/v': unit };

test('word-to-token conversion is not thrown off by floating point', () => {
  expect(wordsToTokens(10)).toBe(14); // 10 * 1.4 === 14.000000000000002 in JS
  expect(wordsToTokens(5)).toBe(7);
  expect(wordsToTokens(3)).toBe(5);
});

// Motion "Remote work beats office work" = 7 tokens; Turn outputs 420, 420, 280, 280, 210, 210.
test('Classic Debate with one Judge', () => {
  expect(worstCaseBudgetMicroUsd(setup, [], unitPrices)).toBe(14079);
});

test('each AI Voter adds a before- and after-stance', () => {
  expect(worstCaseBudgetMicroUsd(setup, ['x/v'], unitPrices)).toBe(17133);
});

test('human Debaters cost nothing', () => {
  const humanFor = { ...setup, debaters: { ...setup.debaters, for: { kind: 'human', memberId: 'm1' } as const } };
  // Drops the three For Turns: (607+420) + (1447+280) + (2007+210)
  expect(worstCaseBudgetMicroUsd(humanFor, [], unitPrices)).toBe(14079 - 4971);
});

test('prices scale cost', () => {
  const double = Object.fromEntries(Object.keys(unitPrices).map(k => [k, { inputPerMTokUsd: 2, outputPerMTokUsd: 2 }]));
  expect(worstCaseBudgetMicroUsd(setup, [], double)).toBe(28158);
});

test('unknown model prices are an error', () => {
  expect(() => worstCaseBudgetMicroUsd(setup, [], {})).toThrow(UnknownModelPriceError);
});
