import type { ModelPrice } from '@debate-arena/engine';
import { PRODUCTION_CATALOG, type Catalog, type CatalogEntry, type ReasoningSupport } from './catalog';
import { createModels, type ModelEnv, type Models } from './factory';

export const CATALOG_TTL_SECONDS = 3600;
export const CATALOG_FETCH_TIMEOUT_MS = 3000;
/** A Classic Debate's Judge prompt is about 5 000 tokens. */
export const MIN_CONTEXT_TOKENS = 16_000;
// Only models that write text and take a token cap; the parser checks both again.
export const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=max_tokens';

/** An entry of OpenRouter's `GET /api/v1/models`, as far as the catalog reads it. */
interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
  reasoning?: { mandatory?: unknown; supported_efforts?: unknown } | null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** USD per token (OpenRouter's strings) to USD per million tokens; null for a missing, negative or odd price. */
function perMillion(pricing: OpenRouterModel['pricing']): ModelPrice | null {
  const toMillion = (v: unknown) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    return Number.isFinite(n) && n >= 0 ? Number((n * 1e6).toPrecision(12)) : null;
  };
  const input = toMillion(pricing?.prompt);
  const output = toMillion(pricing?.completion);
  return input === null || output === null ? null : { inputPerMTokUsd: input, outputPerMTokUsd: output };
}

function reasoningOf(m: OpenRouterModel): { reasoning: ReasoningSupport; leastEffort?: string } {
  if (m.reasoning?.mandatory === true) {
    // Efforts are listed highest first; "none" is never accepted by a mandatory model.
    const least = strings(m.reasoning.supported_efforts).filter(e => e !== 'none').at(-1);
    return { reasoning: 'mandatory', ...(least ? { leastEffort: least } : {}) };
  }
  return { reasoning: strings(m.supported_parameters).includes('reasoning') ? 'optional' : 'unsupported' };
}

/** "Anthropic: Claude Haiku 5.5" → "Claude Haiku 5.5": the picker shows the provider on its own. */
const labelOf = (name: string) => name.replace(/^[^:]+:\s*/, '');

/**
 * The catalog from OpenRouter's model list: text-to-text models with real prices, a token cap and enough context,
 * as Debaters and Judges. `<id>:batch` entries become their base model's batchPrice; `:free` variants are models of
 * their own; routers, aliases (`~…`) and other variants are left out. Curated entries keep everything but a
 * missing batch price, and come first.
 */
export function parseOpenRouterModels(body: unknown, curated: Catalog): Catalog {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error('OpenRouter models: no data array');
  const models = data as OpenRouterModel[];

  const batchPrices = new Map<string, ModelPrice>();
  for (const m of models) {
    if (typeof m.id === 'string' && m.id.endsWith(':batch')) {
      const price = perMillion(m.pricing);
      if (price) batchPrices.set(m.id.slice(0, -':batch'.length), price);
    }
  }

  const live: CatalogEntry[] = [];
  for (const m of models) {
    if (typeof m.id !== 'string' || typeof m.name !== 'string') continue;
    const [base, variant, ...rest] = m.id.split(':');
    if (rest.length > 0 || (variant !== undefined && variant !== 'free')) continue;
    if (!base || base.startsWith('openrouter/') || base.startsWith('~') || !/^[^/]+\/[^/]+$/.test(base)) continue;
    if (!strings(m.architecture?.input_modalities).includes('text')) continue;
    const output = strings(m.architecture?.output_modalities);
    if (output.length !== 1 || output[0] !== 'text') continue;
    if (!strings(m.supported_parameters).includes('max_tokens')) continue;
    if (typeof m.context_length !== 'number' || m.context_length < MIN_CONTEXT_TOKENS) continue;
    const price = perMillion(m.pricing);
    if (!price) continue;

    const label = labelOf(m.name);
    const batchPrice = variant === undefined ? batchPrices.get(base) : undefined;
    live.push({
      id: m.id,
      label: variant === 'free' && !label.endsWith('(free)') ? `${label} (free)` : label,
      price,
      roles: ['debater', 'judge'],
      ...reasoningOf(m),
      ...(batchPrice ? { batchPrice } : {}),
      contextLength: m.context_length,
    });
  }

  const liveById = new Map(live.map(e => [e.id, e]));
  const curatedEntries = curated.entries.map(e => {
    const fromList = liveById.get(e.id);
    return !e.batchPrice && fromList?.batchPrice ? { ...e, batchPrice: fromList.batchPrice } : e;
  });
  const curatedIds = new Set(curated.entries.map(e => e.id));
  const rest = live.filter(e => !curatedIds.has(e.id)).toSorted((a, b) => a.label.localeCompare(b.label));
  return { entries: [...curatedEntries, ...rest] };
}

export interface CatalogDeps {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

type CatalogEnv = ModelEnv & { DB: D1Database };

async function fetchCatalog(env: CatalogEnv, fetcher: typeof fetch, timeoutMs: number): Promise<Catalog> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`OpenRouter models: no answer in ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetcher(MODELS_URL, {
        headers: env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`OpenRouter models: ${response.status}`);
      return parseOpenRouterModels(await response.json(), PRODUCTION_CATALOG);
    })();
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A loader with its own in-memory copy. Order: memory younger than CATALOG_TTL_SECONDS, then the stored row younger
 * than that, then OpenRouter (stored and remembered). When OpenRouter fails: the stored row however old, else the
 * curated catalog; neither is remembered, so the next request tries again.
 */
export function createCatalogLoader(): (env: CatalogEnv, deps?: CatalogDeps) => Promise<Models> {
  let memo: { catalog: Catalog; at: number } | undefined;
  return async (env, deps = {}) => {
    if (env.MODEL_PROVIDER === 'fake') return createModels(env);
    const now = deps.now ?? Date.now;
    const fresh = (at: number) => now() - at < CATALOG_TTL_SECONDS * 1000;
    const withCatalog = (catalog: Catalog) => createModels(env, catalog);

    if (memo && fresh(memo.at)) return withCatalog(memo.catalog);
    const row = await env.DB.prepare('SELECT catalog_json, fetched_at FROM model_catalog WHERE id = 1').first<{
      catalog_json: string;
      fetched_at: string;
    }>();
    const stored = row ? { catalog: JSON.parse(row.catalog_json) as Catalog, at: Date.parse(row.fetched_at) } : undefined;
    if (stored && fresh(stored.at)) {
      memo = stored;
      return withCatalog(stored.catalog);
    }
    try {
      const catalog = await fetchCatalog(env, deps.fetcher ?? ((input, init) => fetch(input, init)), deps.timeoutMs ?? CATALOG_FETCH_TIMEOUT_MS);
      const at = now();
      await env.DB.prepare(
        `INSERT INTO model_catalog (id, catalog_json, fetched_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET catalog_json = excluded.catalog_json, fetched_at = excluded.fetched_at`,
      )
        .bind(JSON.stringify(catalog), new Date(at).toISOString())
        .run();
      memo = { catalog, at };
      return withCatalog(catalog);
    } catch (error) {
      console.warn('Could not load the OpenRouter model list', error);
      return withCatalog(stored?.catalog ?? PRODUCTION_CATALOG);
    }
  };
}

/** The models for this request: the shared loader of this Worker isolate. */
export const loadModels = createCatalogLoader();
