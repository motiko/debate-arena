import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const uniqueMember = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Starts a Debate as a dev Member. Slow Debates use the fake-slow Debater, so they stay live for ~10 s. */
export async function startDebate(
  request: APIRequestContext,
  options: { motion?: string; slow?: boolean; member?: string; aiVoters?: boolean } = {},
): Promise<{ id: string; motion: string }> {
  const motion = options.motion ?? `E2E Motion ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`;
  const model = options.slow ? 'fake-slow/one' : null;
  const response = await request.post('/api/debates', {
    headers: { 'content-type': 'application/json', 'x-dev-member': options.member ?? uniqueMember('starter') },
    data: { motion, debaters: { for: model ?? 'fake-a/one', against: model ?? 'fake-b/one' }, aiVoters: options.aiVoters ?? false },
  });
  expect(response.status(), await response.text()).toBe(201);
  return { id: ((await response.json()) as { id: string }).id, motion };
}

export async function waitComplete(request: APIRequestContext, id: string): Promise<void> {
  await expect
    .poll(async () => ((await (await request.get(`/api/debates/${id}`)).json()) as { status: string }).status, { timeout: 30_000 })
    .not.toBe('running');
}

/**
 * Waits until islands have hydrated (Astro drops the `ssr` attribute), so input reaches Svelte state.
 * `client:visible` islands hydrate only once shown, so only visible ones are waited for.
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator('astro-island[ssr]:not([client="visible"])')).toHaveCount(0);
  await expect(page.locator('astro-island[ssr][client="visible"]:visible')).toHaveCount(0);
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.map(n => n.target.join(' ')) }))).toEqual([]);
}
