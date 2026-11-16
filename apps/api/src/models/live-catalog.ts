import type { ModelPrice } from '@debate-arena/engine';
import { PRODUCTION_CATALOG, type Catalog, type CatalogEntry, type ReasoningSupport } from './catalog';
import { createModels, type ModelEnv, type Models } from './factory';

export const CATALOG_TTL_SECONDS = 3600;
export const CATALOG_FETCH_TIMEOUT_MS = 3000;
/** After a failed fetch, how long the fallback is served before OpenRouter is asked again. */
export const CATALOG_RETRY_SECONDS = 60;
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
  pricing?: Record<string, unknown>;
  supported_parameters?: unknown;
  reasoning?: { mandatory?: unknown; supported_efforts?: unknown } | null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Price keys a Debate never incurs, so they may be non-zero: caching (the platform asks for none, and reads cost
 * less than prompts), the web search plugin (never requested), and image or audio (Debates send text only).
 * `internal_reasoning` is folded into the output price. Any other non-zero key drops the model: the meter and the
 * Budget count tokens only, so an unknown fee would be spent unseen.
 */
const NEVER_INCURRED = new Set(['input_cache_read', 'input_cache_write', 'input_cache_write_1h', 'web_search', 'image', 'audio', 'input_audio_cache']);
/** A long-context price below this many prompt tokens could apply to a Debate's prompts (at most about 11k). */
export const MIN_LONG_CONTEXT_TOKENS = 32_000;

const priceNumber = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const toMillion = (perToken: number) => Number((perToken * 1e6).toPrecision(12));

/**
 * What a Debate pays per million tokens, from OpenRouter's USD-per-token strings: the dearest of the base price, a
 * dearer reasoning price, and any time-of-day price. Null when a price is missing or odd, or when the model has a fee
 * the meter cannot see (see NEVER_INCURRED) or a long-context price a Debate's prompt could reach.
 */
function perMillion(pricing: OpenRouterModel['pricing'], searchesNatively = false): ModelPrice | null {
  if (!pricing) return null;
  let input = priceNumber(pricing.prompt);
  let output = priceNumber(pricing.completion);
  if (input === null || output === null) return null;
  for (const [key, value] of Object.entries(pricing)) {
    if (key === 'prompt' || key === 'completion') continue;
    // A model with built-in search may search on any call: then its search price is a fee like any other.
    if (NEVER_INCURRED.has(key) && !(key === 'web_search' && searchesNatively)) continue;
    if (key === 'internal_reasoning') {
      const reasoning = priceNumber(value);
      if (reasoning === null) return null;
      output = Math.max(output, reasoning);
    } else if (key === 'overrides') {
      if (!Array.isArray(value)) return null;
      for (const override of value as Record<string, unknown>[]) {
        const longContext = typeof override.min_prompt_tokens === 'number';
        const timeOfDay = typeof override.utc_start === 'number' && typeof override.utc_end === 'number';
        const conditions = Object.keys(override).filter(k => !['prompt', 'completion'].includes(k) && !NEVER_INCURRED.has(k));
        const known = conditions.every(k => ['min_prompt_tokens', 'utc_start', 'utc_end'].includes(k));
        if (!known || (!longContext && !timeOfDay)) return null;
        if (longContext) {
          if ((override.min_prompt_tokens as number) < MIN_LONG_CONTEXT_TOKENS) return null;
          continue;
        }
        const peakInput = override.prompt === undefined ? input : priceNumber(override.prompt);
        const peakOutput = override.completion === undefined ? output : priceNumber(override.completion);
        if (peakInput === null || peakOutput === null) return null;
        input = Math.max(input, peakInput);
        output = Math.max(output, peakOutput);
      }
    } else if (priceNumber(value) !== 0) {
      return null;
    }
  }
  return { inputPerMTokUsd: toMillion(input), outputPerMTokUsd: toMillion(output) };
}

function reasoningOf(m: OpenRouterModel): { reasoning: ReasoningSupport; leastEffort?: string } {
  if (m.reasoning?.mandatory === true) {
    // Efforts are listed highest first; "none" is never accepted by a mandatory model.
    const least = strings(m.reasoning.supported_efforts).filter(e => e !== 'none').at(-1);
    return { reasoning: 'mandatory', ...(least ? { leastEffort: least } : {}) };
  }
  return { reasoning: strings(m.supported_parameters).includes('reasoning') ? 'optional' : 'unsupported' };
}

/** Built-in web search (Perplexity, Sakana…): such a model may search, and pay per search, on any call. */
const searchesNatively = (m: OpenRouterModel) => strings(m.supported_parameters).includes('web_search_options');

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
      const price = perMillion(m.pricing, searchesNatively(m));
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
    const price = perMillion(m.pricing, searchesNatively(m));
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

  return withCurated(live, curated);
}

/**
 * `entries` with the curated catalog first, in its order, and in place of any entry of the same id. A curated entry
 * without a batch price takes the one listed for its model. A stored catalog goes through this again on load, so a
 * deploy that changes the curated models applies at once, not when the stored row expires.
 */
export function withCurated(entries: CatalogEntry[], curated: Catalog): Catalog {
  const listed = new Map(entries.map(e => [e.id, e]));
  const curatedEntries = curated.entries.map(e => {
    const fromList = listed.get(e.id);
    return !e.batchPrice && fromList?.batchPrice ? { ...e, batchPrice: fromList.batchPrice } : e;
  });
  const curatedIds = new Set(curated.entries.map(e => e.id));
  const rest = entries.filter(e => !e.curated && !curatedIds.has(e.id)).toSorted((a, b) => a.label.localeCompare(b.label));
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
 * curated catalog, served from memory for CATALOG_RETRY_SECONDS so an outage does not slow every request by the
 * timeout; then OpenRouter is asked again.
 */
export function createCatalogLoader(): (env: CatalogEnv, deps?: CatalogDeps) => Promise<Models> {
  let memo: { catalog: Catalog; at: number } | undefined;
  let fallback: { catalog: Catalog; until: number } | undefined;
  return async (env, deps = {}) => {
    if (env.MODEL_PROVIDER === 'fake') return createModels(env);
    const now = deps.now ?? Date.now;
    const fresh = (at: number) => now() - at < CATALOG_TTL_SECONDS * 1000;
    const withCatalog = (catalog: Catalog) => createModels(env, catalog);

    if (memo && fresh(memo.at)) return withCatalog(memo.catalog);
    if (fallback && now() < fallback.until) return withCatalog(fallback.catalog);
    const row = await env.DB.prepare('SELECT catalog_json, fetched_at FROM model_catalog WHERE id = 1').first<{
      catalog_json: string;
      fetched_at: string;
    }>();
    const stored = row
      ? { catalog: withCurated((JSON.parse(row.catalog_json) as Catalog).entries, PRODUCTION_CATALOG), at: Date.parse(row.fetched_at) }
      : undefined;
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
      fallback = { catalog: stored?.catalog ?? PRODUCTION_CATALOG, until: now() + CATALOG_RETRY_SECONDS * 1000 };
      return withCatalog(fallback.catalog);
    }
  };
}

/** The models for this request: the shared loader of this Worker isolate. */
export const loadModels = createCatalogLoader();
