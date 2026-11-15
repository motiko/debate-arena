import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';
import { catalogFor, isBatchCapable, priceTable, PRODUCTION_CATALOG, REASONING_ALLOWANCE_TOKENS } from '../src/models/catalog';
import { createCatalogLoader, parseOpenRouterModels } from '../src/models/live-catalog';
import fixture from './fixtures/openrouter-models.json';

const parsed = () => parseOpenRouterModels(fixture, PRODUCTION_CATALOG);
const entry = (id: string) => parsed().entries.find(e => e.id === id);

test('keeps text models with real prices, a token cap and enough context; curated first', () => {
  const ids = parsed().entries.map(e => e.id);
  const live = ids.filter(id => !PRODUCTION_CATALOG.entries.some(e => e.id === id));
  expect(ids.slice(0, PRODUCTION_CATALOG.entries.length)).toEqual(PRODUCTION_CATALOG.entries.map(e => e.id));
  // By label: Gemini 4 Hydrogen, Gemma 4 31B (free), GPT-5.4 Nano, Pareto 26.10
  expect(live).toEqual(['google/gemini-4-hydrogen', 'google/gemma-4-31b-it:free', 'openai/gpt-5.4-nano', 'unbiased/pareto-26.10']);
});

test('drops routers, aliases, non-text output, small context, models without max_tokens, and models with fees beyond tokens', () => {
  const ids = parsed().entries.map(e => e.id);
  for (const dropped of ['openrouter/auto', '~unbiased/pareto-latest', 'google/gemini-nano-banana-2.1', 'openai/gpt-4', 'sakana/fugu-max', 'perplexity/sonar', 'acme/per-call']) {
    expect(ids).not.toContain(dropped);
  }
  expect(ids.some(id => id.endsWith(':batch'))).toBe(false);
});

test('maps prices per million tokens, labels without the provider, and Debater and Judge roles', () => {
  expect(entry('openai/gpt-5.4-nano')).toMatchObject({
    label: 'GPT-5.4 Nano',
    price: { inputPerMTokUsd: 0.2, outputPerMTokUsd: 1.25 },
    batchPrice: { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.625 },
    roles: ['debater', 'judge'],
    reasoning: 'optional',
    contextLength: 400000,
  });
  expect(entry('unbiased/pareto-26.10')?.reasoning).toBe('unsupported');
});

describe('only token prices count: other fees are allowed only when the platform never incurs them', () => {
  const model = (id: string, pricing: Record<string, unknown>) => ({
    id,
    name: `Acme: ${id}`,
    context_length: 128000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002', ...pricing },
    supported_parameters: ['max_tokens'],
  });
  const ids = (...models: ReturnType<typeof model>[]) => parseOpenRouterModels({ data: models }, { entries: [] }).entries;

  test('cache, web search (a plugin), image and audio prices are tolerated: Debates send text only', () => {
    const kept = ids(model('acme/cached', { input_cache_read: '0.0000001', input_cache_write: '0.00000125', web_search: '0.01', image: '0.001', audio: '0.00001' }));
    expect(kept.map(e => e.id)).toEqual(['acme/cached']);
  });

  test('a search price counts as a fee when the model searches natively (web_search_options), whatever its provider', () => {
    const native = { ...model('acme/searcher', { web_search: '0.01' }), supported_parameters: ['max_tokens', 'web_search_options'] };
    const free = { ...model('acme/no-fee', { web_search: '0' }), supported_parameters: ['max_tokens', 'web_search_options'] };
    expect(ids(native, free).map(e => e.id)).toEqual(['acme/no-fee']);
  });

  test('a dearer reasoning price becomes the output price', () => {
    const [e] = ids(model('acme/thinks', { internal_reasoning: '0.000005' }));
    expect(e?.price).toEqual({ inputPerMTokUsd: 1, outputPerMTokUsd: 5 });
  });

  test('time-of-day prices count at their highest', () => {
    const [e] = ids(model('acme/peak', { overrides: [{ utc_start: 100, utc_end: 1500, prompt: '0.000003', completion: '0.000001' }] }));
    expect(e?.price).toEqual({ inputPerMTokUsd: 3, outputPerMTokUsd: 2 });
  });

  test('a long-context price from 32k prompt tokens is tolerated; one that starts lower drops the model', () => {
    const kept = ids(
      model('acme/long-ok', { overrides: [{ min_prompt_tokens: 32000, prompt: '0.00001', completion: '0.00002' }] }),
      model('acme/long-low', { overrides: [{ min_prompt_tokens: 8000, prompt: '0.00001', completion: '0.00002' }] }),
    );
    expect(kept.map(e => e.id)).toEqual(['acme/long-ok']);
  });

  test('an unknown fee, an unknown override condition or a fee per request drops the model', () => {
    const kept = ids(
      model('acme/per-minute', { per_minute: '0.01' }),
      model('acme/odd-override', { overrides: [{ weekday: 1, prompt: '0.000001', completion: '0.000002' }] }),
      model('acme/per-request', { request: '0.001' }),
      model('acme/zero-extras', { request: '0', per_minute: '0' }),
    );
    expect(kept.map(e => e.id)).toEqual(['acme/zero-extras']);
  });
});

test('a free variant is its own entry at price 0, labelled (free)', () => {
  expect(entry('google/gemma-4-31b-it:free')).toMatchObject({ label: 'Gemma 4 31B (free)', price: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 } });
});

test('a mandatory-reasoning model asks for its least effort and is never batch-capable', () => {
  const catalog = parsed();
  expect(entry('google/gemini-4-hydrogen')).toMatchObject({ reasoning: 'mandatory', leastEffort: 'low' });
  expect(entry('google/gemini-4-hydrogen')?.batchPrice).toBeDefined();
  expect(isBatchCapable(catalog, 'google/gemini-4-hydrogen')).toBe(false);
  expect(isBatchCapable(catalog, 'openai/gpt-5.4-nano')).toBe(true);
  expect(catalogFor(catalog, 'batch').entries.map(e => e.id)).not.toContain('google/gemini-4-hydrogen');
  expect(priceTable(catalog)['google/gemini-4-hydrogen']?.extraOutputTokens).toBe(REASONING_ALLOWANCE_TOKENS);
  expect(priceTable(catalog)['openai/gpt-5.4-nano']?.extraOutputTokens).toBeUndefined();
});

test('curated entries keep their label, reasoning and roles', () => {
  expect(entry('anthropic/claude-haiku-5.5')).toMatchObject({ label: 'Claude Haiku 5.5', reasoning: 'optional', curated: true });
  expect(entry('anthropic/claude-haiku-5.5')?.roles).toContain('voter');
});

test('a body without a data array is an error', () => {
  expect(() => parseOpenRouterModels({ error: 'nope' }, PRODUCTION_CATALOG)).toThrow();
});

const modelEnv = { MODEL_PROVIDER: 'openrouter' as const, OPENROUTER_API_KEY: 'k', DB: env.DB };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const HOUR = 3600_000;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM model_catalog').run();
});

test('fetches with the key, stores the catalog, then serves it from memory', async () => {
  const urls: string[] = [];
  const auth: (string | null)[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    auth.push(new Headers(init?.headers).get('authorization'));
    return json(fixture);
  }) as typeof fetch;
  const load = createCatalogLoader();
  const first = await load(modelEnv, { fetcher, now: () => 0 });
  const second = await load(modelEnv, { fetcher, now: () => 10 });
  expect(urls).toEqual(['https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=max_tokens']);
  expect(auth).toEqual(['Bearer k']);
  expect(second.catalog).toEqual(first.catalog);
  expect(first.catalog.entries.map(e => e.id)).toContain('openai/gpt-5.4-nano');
  const row = await env.DB.prepare('SELECT fetched_at FROM model_catalog').first<{ fetched_at: string }>();
  expect(row?.fetched_at).toBe(new Date(0).toISOString());
});

test('a fresh stored catalog is used without fetching', async () => {
  await createCatalogLoader()(modelEnv, { fetcher: (async () => json(fixture)) as typeof fetch, now: () => 0 });
  let fetched = false;
  const fetcher = (async () => {
    fetched = true;
    return json(fixture);
  }) as typeof fetch;
  const models = await createCatalogLoader()(modelEnv, { fetcher, now: () => HOUR - 1 });
  expect(fetched).toBe(false);
  expect(models.catalog.entries.map(e => e.id)).toContain('openai/gpt-5.4-nano');
});

test('a stored catalog older than an hour is fetched again and replaced', async () => {
  await createCatalogLoader()(modelEnv, { fetcher: (async () => json(fixture)) as typeof fetch, now: () => 0 });
  const fewer = { data: fixture.data.filter(m => m.id !== 'openai/gpt-5.4-nano') };
  const models = await createCatalogLoader()(modelEnv, { fetcher: (async () => json(fewer)) as typeof fetch, now: () => HOUR + 1 });
  expect(models.catalog.entries.map(e => e.id)).not.toContain('openai/gpt-5.4-nano');
  const row = await env.DB.prepare('SELECT fetched_at FROM model_catalog').first<{ fetched_at: string }>();
  expect(row?.fetched_at).toBe(new Date(HOUR + 1).toISOString());
});

test('OpenRouter down and nothing stored: the curated catalog', async () => {
  const fetcher = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const models = await createCatalogLoader()(modelEnv, { fetcher, now: () => 0 });
  expect(models.catalog).toBe(PRODUCTION_CATALOG);
});

test('OpenRouter hangs: the stale stored catalog, within the timeout', async () => {
  await createCatalogLoader()(modelEnv, { fetcher: (async () => json(fixture)) as typeof fetch, now: () => 0 });
  const hang = (() => new Promise<Response>(() => {})) as typeof fetch;
  const started = Date.now();
  const models = await createCatalogLoader()(modelEnv, { fetcher: hang, now: () => 5 * HOUR, timeoutMs: 50 });
  expect(Date.now() - started).toBeLessThan(2000);
  expect(models.catalog.entries.map(e => e.id)).toContain('openai/gpt-5.4-nano');
});

test('OpenRouter answers HTML: the stale stored catalog, which is not overwritten', async () => {
  await createCatalogLoader()(modelEnv, { fetcher: (async () => json(fixture)) as typeof fetch, now: () => 0 });
  const html = (async () => new Response('<html>oops</html>', { status: 200 })) as typeof fetch;
  const models = await createCatalogLoader()(modelEnv, { fetcher: html, now: () => 5 * HOUR });
  expect(models.catalog.entries.map(e => e.id)).toContain('openai/gpt-5.4-nano');
  const row = await env.DB.prepare('SELECT fetched_at FROM model_catalog').first<{ fetched_at: string }>();
  expect(row?.fetched_at).toBe(new Date(0).toISOString());
});

test('after a failed fetch, OpenRouter is not asked again for a minute: the fallback is served at once', async () => {
  let fetches = 0;
  const fetcher = (async () => {
    fetches += 1;
    throw new Error('network down');
  }) as typeof fetch;
  const load = createCatalogLoader();
  await load(modelEnv, { fetcher, now: () => 0 });
  const again = await load(modelEnv, { fetcher, now: () => 59_000 });
  expect(fetches).toBe(1);
  expect(again.catalog).toBe(PRODUCTION_CATALOG);
  await load(modelEnv, { fetcher, now: () => 61_000 });
  expect(fetches).toBe(2);
});

test('the fake provider never fetches', async () => {
  const fetcher = (async () => {
    throw new Error('must not fetch');
  }) as typeof fetch;
  const models = await createCatalogLoader()({ MODEL_PROVIDER: 'fake', DB: env.DB }, { fetcher });
  expect(models.catalog.entries[0]?.id).toBe('fake-a/one');
});
