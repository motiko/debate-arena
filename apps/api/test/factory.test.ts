import {
  CLASSIC_FORMAT,
  FakeModelClient,
  JUDGE_OUTPUT_TOKENS,
  parseScreen,
  parseStance,
  parseVerdict,
  SCREEN_OUTPUT_TOKENS,
  STANCE_OUTPUT_TOKENS,
} from '@debate-arena/engine';
import { expect, test, vi } from 'vitest';
import { FAKE_CATALOG, hasRole, PRODUCTION_CATALOG, screenerFor } from '../src/models/catalog';
import { BudgetExhaustedError, createModels, devFakeReply, meteredClient, SLOW_FAKE_DELAY_MS, STREAM_FAKE_SPEECH } from '../src/models/factory';
import { OpenRouterError, OpenRouterModelClient } from '../src/models/openrouter';

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

const ask = (maxOutputTokens: number, content = 'x') =>
  devFakeReply({ model: 'fake-a/one', messages: [{ role: 'user', content }], maxOutputTokens });

test('dev fake replies parse as a Verdict and as stances', () => {
  expect(parseVerdict(ask(JUDGE_OUTPUT_TOKENS), CLASSIC_FORMAT.rubric)?.scores).toHaveLength(CLASSIC_FORMAT.rubric.criteria.length);
  expect(parseVerdict(ask(JUDGE_OUTPUT_TOKENS), CLASSIC_FORMAT.rubric)).toMatchObject({ confidence: 'likely', crux: expect.any(String), claims: [expect.objectContaining({ status: 'disputed' })] });
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

test('the metered client passes drafts through and still charges the reply', async () => {
  const costs: number[] = [];
  const seen: string[] = [];
  const client = meteredClient(new FakeModelClient(() => 'one two three'), { 'a/x': { inputPerMTokUsd: 1, outputPerMTokUsd: 1 } }, async c => {
    costs.push(c);
  });
  const reply = await client.complete({ model: 'a/x', messages: [{ role: 'user', content: 'a' }], maxOutputTokens: 5 }, { onText: t => seen.push(t) });
  expect(seen).toEqual(['one', 'one two', 'one two three']);
  expect(seen.at(-1)).toBe(reply.text);
  expect(costs).toHaveLength(1);
});

test('the local slow fake streams a reply worth watching over SLOW_FAKE_DELAY_MS', async () => {
  vi.useFakeTimers();
  try {
    const { client } = createModels({ MODEL_PROVIDER: 'fake' });
    const seen: string[] = [];
    const reply = client.complete({ model: 'fake-slow/one', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 100 }, { onText: t => seen.push(t) });
    await vi.advanceTimersByTimeAsync(SLOW_FAKE_DELAY_MS / 2);
    const halfway = seen.length;
    expect(halfway).toBeGreaterThan(3);
    await vi.advanceTimersByTimeAsync(SLOW_FAKE_DELAY_MS / 2);
    const { text } = await reply;
    expect(seen.length).toBeGreaterThan(halfway);
    expect(seen.at(-1)).toBe(text);
    expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(30);
  } finally {
    vi.useRealTimers();
  }
});

test("the local streaming fake sends a full-length speech in uneven bursts, at a real model's pace", async () => {
  vi.useFakeTimers();
  try {
    const { client } = createModels({ MODEL_PROVIDER: 'fake' });
    const seen: { at: number; text: string }[] = [];
    const reply = client.complete(
      { model: 'fake-stream/one', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 1000 },
      { onText: text => seen.push({ at: Date.now(), text }) },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const { text } = await reply;
    expect(text).toBe(STREAM_FAKE_SPEECH);
    expect(text.split('\n\n')).toHaveLength(4);
    const took = seen.at(-1)!.at - seen[0]!.at;
    expect(took).toBeGreaterThan(4_000);
    expect(took).toBeLessThan(12_000);
    // Several words share an instant, as network chunks do, and the gaps between instants vary.
    const instants = [...new Set(seen.map(s => s.at))];
    expect(instants.length).toBeLessThan(seen.length / 3);
    const gaps = instants.slice(1).map((at, i) => at - instants[i]!);
    expect(Math.max(...gaps)).toBeGreaterThan(2 * Math.min(...gaps));
  } finally {
    vi.useRealTimers();
  }
});

test('a failed call that carries a charge is metered, then still fails', async () => {
  const costs: number[] = [];
  const failing = {
    complete: async () => {
      throw new OpenRouterError('stream cut', null, { inputTokens: 10, outputTokens: 20 });
    },
  };
  const client = meteredClient(failing, { 'a/x': { inputPerMTokUsd: 1, outputPerMTokUsd: 2 } }, async c => {
    costs.push(c);
  });
  await expect(client.complete({ model: 'a/x', messages: [], maxOutputTokens: 20 })).rejects.toThrow('stream cut');
  expect(costs).toEqual([50]); // 10 × 1 + 20 × 2
});

test('a failed call without a charge records nothing', async () => {
  const costs: number[] = [];
  const failing = {
    complete: async () => {
      throw new OpenRouterError('rate limited', 429);
    },
  };
  const client = meteredClient(failing, { 'a/x': { inputPerMTokUsd: 1, outputPerMTokUsd: 2 } }, async c => {
    costs.push(c);
  });
  await expect(client.complete({ model: 'a/x', messages: [], maxOutputTokens: 20 })).rejects.toThrow('rate limited');
  expect(costs).toEqual([]);
});

test('metering checks the Budget guard before every call', async () => {
  const client = new FakeModelClient();
  let allowed = true;
  const metered = meteredClient(client, { 'a/x': { inputPerMTokUsd: 1, outputPerMTokUsd: 1 } }, async () => {}, async () => {
    if (!allowed) throw new BudgetExhaustedError('spent');
  });
  await metered.complete({ model: 'a/x', messages: [], maxOutputTokens: 5 });
  allowed = false;
  await expect(metered.complete({ model: 'a/x', messages: [], maxOutputTokens: 5 })).rejects.toBeInstanceOf(BudgetExhaustedError);
  expect(client.calls).toHaveLength(1);
});

test('metering a model without a price records nothing rather than NaN', async () => {
  const costs: number[] = [];
  const client = meteredClient(new FakeModelClient(), {}, async c => {
    costs.push(c);
  });
  await client.complete({ model: 'a/x', messages: [], maxOutputTokens: 5 });
  expect(costs).toEqual([]);
});

test('fake-slow Debater replies after the slow delay', async () => {
  vi.useFakeTimers();
  try {
    const { client } = createModels({ MODEL_PROVIDER: 'fake' });
    let done = false;
    const reply = client.complete({ model: 'fake-slow/one', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 100 }).then(r => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(SLOW_FAKE_DELAY_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await reply).text).toContain('fake speech for local development');
  } finally {
    vi.useRealTimers();
  }
});

test('the fake screener flags only [flag-test] Motions', () => {
  const screen = (content: string) =>
    devFakeReply({ model: 'fake-guard/one', messages: [{ role: 'user', content }], maxOutputTokens: SCREEN_OUTPUT_TOKENS });
  expect(parseScreen(screen('"Cats beat dogs"'))).toEqual({ flagged: false, categories: [] });
  expect(parseScreen(screen('"Cats [flag-test]"'))).toEqual({ flagged: true, categories: ['S10'] });
});

test('each catalog has a screener that screens only', () => {
  for (const catalog of [FAKE_CATALOG, PRODUCTION_CATALOG]) {
    const screener = screenerFor(catalog);
    expect(catalog.entries.find(e => e.id === screener)?.roles).toEqual(['screener']);
  }
  expect(screenerFor(PRODUCTION_CATALOG)).toBe('meta-llama/llama-guard-4-12b');
});

test('fake-slow is a Debater only', () => {
  expect(hasRole(FAKE_CATALOG, 'fake-slow/one', 'debater')).toBe(true);
  expect(hasRole(FAKE_CATALOG, 'fake-slow/one', 'judge')).toBe(false);
});

test('fake-stream is a Debater only', () => {
  expect(hasRole(FAKE_CATALOG, 'fake-stream/one', 'debater')).toBe(true);
  expect(hasRole(FAKE_CATALOG, 'fake-stream/one', 'judge')).toBe(false);
});
