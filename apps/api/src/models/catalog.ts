import { modelFamily, type ModelId, type ModelPrice, type PriceTable } from '@debate-arena/engine';

export type ModelRole = 'debater' | 'judge' | 'voter';

/**
 * 'optional': reasoning can be switched off, and the OpenRouter client does so.
 * 'unsupported': the model does not reason. Models with mandatory reasoning are not allowed yet, because
 * hidden reasoning tokens would eat Turn token caps and break the worst-case Budget.
 */
export type ReasoningSupport = 'optional' | 'unsupported';

export interface CatalogEntry { id: ModelId; label: string; price: ModelPrice; roles: ModelRole[]; reasoning: ReasoningSupport }
export interface Catalog { entries: CatalogEntry[] }

export const AI_VOTER_COUNT = 10;

const ALL_ROLES: ModelRole[] = ['debater', 'judge', 'voter'];
const price = (inputPerMTokUsd: number, outputPerMTokUsd: number): ModelPrice => ({ inputPerMTokUsd, outputPerMTokUsd });

/** Prices in USD per million tokens, from https://openrouter.ai/api/v1/models on 2026-11-13. */
export const PRODUCTION_CATALOG: Catalog = {
  entries: [
    { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', price: price(0.1, 0.5), roles: ALL_ROLES, reasoning: 'optional' },
    { id: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', price: price(1, 5), roles: ALL_ROLES, reasoning: 'optional' },
    { id: 'mistralai/mistral-large-4-0', label: 'Mistral Large 4', price: price(0.7, 2.1), roles: ALL_ROLES, reasoning: 'optional' },
    { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', price: price(0.3, 1.2), roles: ALL_ROLES, reasoning: 'optional' },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', price: price(0.35, 1), roles: ['debater', 'voter'], reasoning: 'unsupported' },
    { id: 'qwen/qwen3.8-flash', label: 'Qwen 3.8 Flash', price: price(0.15, 0.47), roles: ['debater', 'voter'], reasoning: 'optional' },
    { id: 'mistralai/mistral-small-2603', label: 'Mistral Small', price: price(0.15, 0.6), roles: ['voter'], reasoning: 'optional' },
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
    })),
    { id: 'fake-a/debater-only', label: 'Fake A (Debater only)', price: price(1, 1), roles: ['debater'], reasoning: 'unsupported' },
    // Replies after a delay, so a local Debate stays live long enough to watch (and to test live pages).
    { id: 'fake-slow/one', label: 'Fake Slow (Debater only)', price: price(1, 1), roles: ['debater'], reasoning: 'unsupported' },
  ],
};

export function priceTable(catalog: Catalog): PriceTable {
  return Object.fromEntries(catalog.entries.map(e => [e.id, e.price]));
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
