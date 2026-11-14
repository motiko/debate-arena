import { modelFamily } from '@debate-arena/engine';
import { expect, test } from 'vitest';
import {
  AI_VOTER_COUNT,
  FAKE_CATALOG,
  hasRole,
  modelsFor,
  pickAiVoters,
  priceTable,
  PRODUCTION_CATALOG,
} from '../src/models/catalog';

const catalogs = [['production', PRODUCTION_CATALOG], ['fake', FAKE_CATALOG]] as const;

test.each(catalogs)('%s: entries have valid prices, roles, reasoning and ids', (_, c) => {
  for (const e of c.entries) {
    for (const p of [e.price.inputPerMTokUsd, e.price.outputPerMTokUsd]) expect(Number.isFinite(p) && p >= 0).toBe(true);
    expect(e.roles.length).toBeGreaterThan(0);
    expect(['optional', 'unsupported']).toContain(e.reasoning);
    expect(e.id).toMatch(/^[^/]+\/[^/]+$/);
  }
  expect(new Set(c.entries.map(e => e.id)).size).toBe(c.entries.length);
});

test.each(catalogs)('%s: Judges and voters span three families', (_, c) => {
  expect(new Set(modelsFor(c, 'judge').map(modelFamily)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(modelsFor(c, 'voter').map(modelFamily)).size).toBeGreaterThanOrEqual(3);
});

test('ten AI Voters rotate across families', () => {
  for (const c of [FAKE_CATALOG, PRODUCTION_CATALOG]) {
    const voters = pickAiVoters(c, AI_VOTER_COUNT);
    expect(voters).toHaveLength(10);
    for (let i = 1; i < voters.length; i++) expect(modelFamily(voters[i]!)).not.toBe(modelFamily(voters[i - 1]!));
    for (const v of voters) expect(hasRole(c, v, 'voter')).toBe(true);
  }
});

test('hasRole checks catalog membership and role', () => {
  expect(hasRole(FAKE_CATALOG, 'fake-a/debater-only', 'debater')).toBe(true);
  expect(hasRole(FAKE_CATALOG, 'fake-a/debater-only', 'judge')).toBe(false);
  expect(hasRole(FAKE_CATALOG, 'evil/model', 'debater')).toBe(false);
});

test('priceTable covers exactly the catalog', () => {
  expect(Object.keys(priceTable(FAKE_CATALOG)).toSorted()).toEqual(FAKE_CATALOG.entries.map(e => e.id).toSorted());
});

test('the production catalog has no model whose reasoning is mandatory', () => {
  // OpenRouter refuses reasoning-off for google/gemini-3.8-flash ("Reasoning is mandatory for this endpoint and cannot
  // be disabled", live and batch, 2026-11-14; its /models entry says reasoning.mandatory: true). Hidden reasoning
  // tokens would break the Budget, so it must not be offered in any role. mistralai/mistral-large-4-0 is the same
  // without the flag: its provider refuses reasoning_effort "none" (only low, medium or high).
  const ids = PRODUCTION_CATALOG.entries.map(e => e.id);
  expect(ids).not.toContain('google/gemini-3.8-flash');
  expect(ids).not.toContain('mistralai/mistral-large-4-0');
});
