import { modelFamily, type ModelId, type ModelPrice, type PriceTable } from '@debate-arena/engine';

export type ModelRole = 'debater' | 'judge' | 'voter' | 'screener';

/**
 * 'optional': reasoning can be switched off, and the OpenRouter client does so.
 * 'unsupported': the model does not reason.
 * 'mandatory': the model always reasons. Its calls ask for its least effort and get REASONING_ALLOWANCE_TOKENS more
 * output, which the worst-case Budget reserves, so hidden reasoning cannot eat the Turn's cap unpaid.
 */
export type ReasoningSupport = 'optional' | 'unsupported' | 'mandatory';

/** Extra output tokens on every call to a mandatory-reasoning model (reasoning counts against max_tokens). */
export const REASONING_ALLOWANCE_TOKENS = 2048;

export interface CatalogEntry {
  id: ModelId;
  label: string;
  price: ModelPrice;
  roles: ModelRole[];
  reasoning: ReasoningSupport;
  /** Present when OpenRouter's Batch API serves this model (its `<id>:batch` price). See isBatchCapable. */
  batchPrice?: ModelPrice;
  contextLength?: number;
  /** Hand-picked and verified: only curated models are AI Voters, the screener and suggested Judges. */
  curated?: true;
  /** The platform's choice of Judge when none is given: the first suggested one, in catalog order (see suggestPanel). */
  suggestedJudge?: true;
  /** For a mandatory-reasoning model: the least reasoning effort it accepts. */
  leastEffort?: string;
}

/** How the OpenRouter clients treat a model's reasoning. */
export interface ReasoningMode { support: ReasoningSupport; leastEffort?: string }
export interface Catalog { entries: CatalogEntry[] }

export const AI_VOTER_COUNT = 10;

const ALL_ROLES: ModelRole[] = ['debater', 'judge', 'voter'];
const price = (inputPerMTokUsd: number, outputPerMTokUsd: number): ModelPrice => ({ inputPerMTokUsd, outputPerMTokUsd });

/**
 * Prices in USD per million tokens, from https://openrouter.ai/api/v1/models on 2026-11-13 (batch prices on 2026-11-14;
 * the suggested Judges on 2026-11-16). The suggested Judges are capable models from five families, cheapest first, so
 * the default Judge is Qwen 4 Max unless a Qwen model debates.
 */
export const PRODUCTION_CATALOG: Catalog = {
  entries: (
    [
    { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', price: price(0.1, 0.5), roles: ALL_ROLES, reasoning: 'optional', batchPrice: price(0.05, 0.25) },
    { id: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', price: price(1, 5), roles: ALL_ROLES, reasoning: 'optional', batchPrice: price(0.5, 2.5) },
    // Batch-capable; its batch price is above the cheapest normal provider (0.051/0.203 on 2026-11-14), not a discount.
    { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', price: price(0.3, 1.2), roles: ALL_ROLES, reasoning: 'optional', batchPrice: price(0.112, 0.336) },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', price: price(0.35, 1), roles: ['debater', 'voter'], reasoning: 'unsupported' },
    { id: 'qwen/qwen3.8-flash', label: 'Qwen 3.8 Flash', price: price(0.15, 0.47), roles: ['debater', 'voter'], reasoning: 'optional' },
    { id: 'mistralai/mistral-small-2603', label: 'Mistral Small', price: price(0.15, 0.6), roles: ['voter'], reasoning: 'optional' },
    { id: 'qwen/qwen4-max', label: 'Qwen 4 Max', price: price(1.5, 4.5), roles: ['debater', 'judge'], reasoning: 'optional', suggestedJudge: true },
    { id: 'x-ai/grok-4.7', label: 'Grok 4.7', price: price(2, 6), roles: ['debater', 'judge'], reasoning: 'mandatory', leastEffort: 'low', suggestedJudge: true },
    { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', price: price(2, 10), roles: ['debater', 'judge'], reasoning: 'mandatory', leastEffort: 'low', suggestedJudge: true },
    { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', price: price(2, 12), roles: ['debater', 'judge'], reasoning: 'mandatory', leastEffort: 'low', suggestedJudge: true },
    { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', price: price(4, 20), roles: ['debater', 'judge'], reasoning: 'mandatory', leastEffort: 'low', suggestedJudge: true },
    // Screens Motions for abuse (flag only). Answers "safe" or "unsafe" plus hazard codes.
    { id: 'meta-llama/llama-guard-4-12b', label: 'Llama Guard 4', price: price(0.18, 0.18), roles: ['screener'], reasoning: 'unsupported' },
    ] satisfies CatalogEntry[]
  ).map(e => ({ ...e, curated: true as const })),
};

/** Offline catalog for local dev and tests (MODEL_PROVIDER=fake). */
export const FAKE_CATALOG: Catalog = {
  entries: [
    ...['fake-a', 'fake-b', 'fake-c', 'fake-d'].map(family => ({
      id: `${family}/one`,
      label: `Fake ${family.slice(-1).toUpperCase()}`,
      price: price(1, 1),
      roles: ALL_ROLES,
      reasoning: 'unsupported' as const,
      batchPrice: price(0.5, 0.5),
    })),
    { id: 'fake-a/debater-only', label: 'Fake A (Debater only)', price: price(1, 1), roles: ['debater'], reasoning: 'unsupported' },
    { id: 'fake-guard/one', label: 'Fake Guard (screener)', price: price(1, 1), roles: ['screener'], reasoning: 'unsupported' },
    // Replies after a delay, so a local Debate stays live long enough to watch (and to test live pages).
    { id: 'fake-slow/one', label: 'Fake Slow (Debater only)', price: price(1, 1), roles: ['debater'], reasoning: 'unsupported' },
    // Streams a full-length speech at a real model's uneven pace, to see locally how a live speech reads.
    { id: 'fake-stream/one', label: 'Fake Streaming (Debater only)', price: price(1, 1), roles: ['debater'], reasoning: 'unsupported' },
  ],
};

export type DebateKind = 'live' | 'batch';

/** Served by the Batch API, and not mandatory-reasoning (a batch call cannot be capped against hidden reasoning). */
const batchCapable = (e: CatalogEntry) => e.batchPrice !== undefined && e.reasoning !== 'mandatory';

export function isBatchCapable(catalog: Catalog, id: ModelId): boolean {
  return catalog.entries.some(e => e.id === id && batchCapable(e));
}

/** How the OpenRouter clients treat each model's reasoning; a model not in the catalog is left alone. */
export function reasoningOf(catalog: Catalog): (id: ModelId) => ReasoningMode {
  return id => {
    const e = catalog.entries.find(entry => entry.id === id);
    return { support: e?.reasoning ?? 'unsupported', ...(e?.leastEffort ? { leastEffort: e.leastEffort } : {}) };
  };
}

/**
 * The models a Debate of this kind may use, at the prices it pays. For a Batch Debate: batch-capable models at
 * their batch price, plus the screener (Motion screening stays a normal call) at its normal price.
 */
export function catalogFor(catalog: Catalog, kind: DebateKind): Catalog {
  if (kind === 'live') return catalog;
  return {
    entries: catalog.entries.flatMap(e => {
      if (batchCapable(e)) return [{ ...e, price: e.batchPrice! }];
      return e.roles.includes('screener') ? [e] : [];
    }),
  };
}

export function priceTable(catalog: Catalog): PriceTable {
  return Object.fromEntries(
    catalog.entries.map(e => [e.id, e.reasoning === 'mandatory' ? { ...e.price, extraOutputTokens: REASONING_ALLOWANCE_TOKENS } : e.price]),
  );
}

/** The model that screens Motions. */
export function screenerFor(catalog: Catalog): ModelId {
  const screener = catalog.entries.find(e => e.roles.includes('screener'));
  if (!screener) throw new Error('The catalog has no screener');
  return screener.id;
}

export function modelsFor(catalog: Catalog, role: ModelRole): ModelId[] {
  return catalog.entries.filter(e => e.roles.includes(role)).map(e => e.id);
}

export function hasRole(catalog: Catalog, id: ModelId, role: ModelRole): boolean {
  return catalog.entries.some(e => e.id === id && e.roles.includes(role));
}

/** Picks AI Voters round-robin across model families, in catalog order, so neighbours never share a family. */
export function pickAiVoters(catalog: Catalog, count: number): ModelId[] {
  const byFamily = new Map<string, ModelId[]>();
  for (const id of modelsFor(catalog, 'voter')) byFamily.set(modelFamily(id), [...(byFamily.get(modelFamily(id)) ?? []), id]);
  const families = [...byFamily.values()];
  if (families.length === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const family = families[i % families.length]!;
    return family[Math.floor(i / families.length) % family.length]!;
  });
}
