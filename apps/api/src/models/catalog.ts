import { modelFamily, type ModelId, type ModelPrice, type PriceTable } from '@debate-arena/engine';

export type ModelRole = 'debater' | 'judge' | 'voter' | 'screener';

/**
 * 'optional': reasoning can be switched off, and the OpenRouter client does so.
 * 'unsupported': the model does not reason. Models with mandatory reasoning are not allowed yet, because
 * hidden reasoning tokens would eat Turn token caps and break the worst-case Budget.
 */
export type ReasoningSupport = 'optional' | 'unsupported';

export interface CatalogEntry {
  id: ModelId;
  label: string;
  price: ModelPrice;
  roles: ModelRole[];
  reasoning: ReasoningSupport;
  /** Present when OpenRouter's Batch API serves this model (its `<id>:batch` price); Batch Debates use only these. */
  batchPrice?: ModelPrice;
}
export interface Catalog { entries: CatalogEntry[] }

export const AI_VOTER_COUNT = 10;

const ALL_ROLES: ModelRole[] = ['debater', 'judge', 'voter'];
const price = (inputPerMTokUsd: number, outputPerMTokUsd: number): ModelPrice => ({ inputPerMTokUsd, outputPerMTokUsd });

/** Prices in USD per million tokens, from https://openrouter.ai/api/v1/models on 2026-11-13 (batch prices and Gemini on 2026-11-14). */
export const PRODUCTION_CATALOG: Catalog = {
  entries: [
    { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', price: price(0.1, 0.5), roles: ALL_ROLES, reasoning: 'optional', batchPrice: price(0.05, 0.25) },
    { id: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', price: price(1, 5), roles: ALL_ROLES, reasoning: 'optional', batchPrice: price(0.5, 2.5) },
    // Not batch-capable for us: OpenRouter's batch endpoint refuses it with reasoning off ("Reasoning is mandatory for
    // this endpoint and cannot be disabled", 2026-11-14), and mandatory reasoning would break the Budget.
    { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', price: price(0.825, 4.125), roles: ALL_ROLES, reasoning: 'optional' },
    { id: 'mistralai/mistral-large-4-0', label: 'Mistral Large 4', price: price(0.7, 2.1), roles: ALL_ROLES, reasoning: 'optional' },
    // Batch-capable; its batch price is above the cheapest normal provider (0.051/0.203 on 2026-11-14), not a discount.
    { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', price: price(0.3, 1.2), roles: ALL_ROLES, reasoning: 'optional', batchPrice: price(0.112, 0.336) },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', price: price(0.35, 1), roles: ['debater', 'voter'], reasoning: 'unsupported' },
    { id: 'qwen/qwen3.8-flash', label: 'Qwen 3.8 Flash', price: price(0.15, 0.47), roles: ['debater', 'voter'], reasoning: 'optional' },
    { id: 'mistralai/mistral-small-2603', label: 'Mistral Small', price: price(0.15, 0.6), roles: ['voter'], reasoning: 'optional' },
    // Screens Motions for abuse (flag only). Answers "safe" or "unsafe" plus hazard codes.
    { id: 'meta-llama/llama-guard-4-12b', label: 'Llama Guard 4', price: price(0.18, 0.18), roles: ['screener'], reasoning: 'unsupported' },
  ],
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
  ],
};

export type DebateKind = 'live' | 'batch';

export function isBatchCapable(catalog: Catalog, id: ModelId): boolean {
  return catalog.entries.some(e => e.id === id && e.batchPrice !== undefined);
}

/**
 * The models a Debate of this kind may use, at the prices it pays. For a Batch Debate: batch-capable models at
 * their batch price, plus the screener (Motion screening stays a normal call) at its normal price.
 */
export function catalogFor(catalog: Catalog, kind: DebateKind): Catalog {
  if (kind === 'live') return catalog;
  return {
    entries: catalog.entries.flatMap(e => {
      if (e.batchPrice) return [{ ...e, price: e.batchPrice }];
      return e.roles.includes('screener') ? [e] : [];
    }),
  };
}

export function priceTable(catalog: Catalog): PriceTable {
  return Object.fromEntries(catalog.entries.map(e => [e.id, e.price]));
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
