import { FakeModelClient, JUDGE_OUTPUT_TOKENS, parseStance, parseVerdict, STANCE_OUTPUT_TOKENS } from '@debate-arena/engine';
import { expect, test } from 'vitest';
import { FAKE_CATALOG, PRODUCTION_CATALOG } from '../src/models/catalog';
import { createModels, devFakeReply, meteredClient } from '../src/models/factory';
import { OpenRouterModelClient } from '../src/models/openrouter';

test('fake provider uses the fake catalog', () => {
  const models = createModels({ MODEL_PROVIDER: 'fake' });
  expect(models.catalog).toBe(FAKE_CATALOG);
  expect(models.client).toBeInstanceOf(FakeModelClient);
});

test('openrouter provider uses the production catalog and requires a key', () => {
  expect(() => createModels({ MODEL_PROVIDER: 'openrouter' })).toThrow(/OPENROUTER_API_KEY/);
  const models = createModels({ MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' });
  expect(models.catalog).toBe(PRODUCTION_CATALOG);
  expect(models.client).toBeInstanceOf(OpenRouterModelClient);
});

test('dev fake replies parse as a Verdict and as stances', () => {
  const ask = (maxOutputTokens: number, content = 'x') => devFakeReply({ model: 'fake-a/one', messages: [{ role: 'user', content }], maxOutputTokens });
  expect(parseVerdict(ask(JUDGE_OUTPUT_TOKENS))).not.toBeNull();
  expect(parseStance(ask(STANCE_OUTPUT_TOKENS))).toBe('undecided');
  expect(parseStance(ask(STANCE_OUTPUT_TOKENS, 'You have heard the whole debate.'))).toMatch(/^(for|against)$/);
  expect(ask(840).length).toBeGreaterThan(0);
});

test('metering reports cost from tokens and prices', async () => {
  const costs: number[] = [];
  const client = meteredClient(new FakeModelClient(() => 'one two'), { 'a/x': { inputPerMTokUsd: 2, outputPerMTokUsd: 5 } }, async c => {
    costs.push(c);
  });
  await client.complete({ model: 'a/x', messages: [{ role: 'user', content: 'a b c' }], maxOutputTokens: 5 });
  expect(costs).toEqual([16]); // 3 input tokens × 2 + 2 output tokens × 5
});

test('metering a model without a price records nothing rather than NaN', async () => {
  const costs: number[] = [];
  const client = meteredClient(new FakeModelClient(), {}, async c => {
    costs.push(c);
  });
  await client.complete({ model: 'a/x', messages: [], maxOutputTokens: 5 });
  expect(costs).toEqual([]);
});
