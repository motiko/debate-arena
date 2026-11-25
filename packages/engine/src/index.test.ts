import { expect, test } from 'vitest';
import {
  ENGINE_VERSION,
  FakeModelClient,
  generateTurn,
  judgeDebate,
  nextSlot,
  runAiAudience,
  worstCaseBudgetMicroUsd,
  type Turn,
} from './index';
import { setup } from './testing/fixtures';

test('engine exports a version', () => {
  expect(ENGINE_VERSION).toBe('0.1.0');
});

test('runs a full Classic Debate offline', async () => {
  const client = new FakeModelClient(r =>
    r.maxOutputTokens === 1000 ? '{"winner":"for","reasoning":"ok"}' : r.maxOutputTokens === 10 ? 'for' : 'An argument.');
  const turns: Turn[] = [];
  while (nextSlot(setup.format, turns)) turns.push(await generateTurn(setup, turns, client));
  expect(turns).toHaveLength(6);
  expect((await judgeDebate(setup, turns, client)).winner).toBe('for');
  expect((await runAiAudience(setup, turns, ['x/v'], client)).counted).toBe(1);
  expect(typeof worstCaseBudgetMicroUsd).toBe('function');
});
