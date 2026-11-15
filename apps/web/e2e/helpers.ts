import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const uniqueMember = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Starts a Debate as a dev Member. A paced one seats the fake-slow Debater, which keeps it live for ~10 s, streaming. */
export async function startDebate(
  request: APIRequestContext,
  options: { motion?: string; paced?: boolean; member?: string; aiVoters?: boolean } = {},
): Promise<{ id: string; motion: string }> {
  const motion = options.motion ?? `E2E Motion ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`;
  const model = options.paced ? 'fake-slow/one' : null;
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
 * Waits until islands have hydrated (Astro drops the `ssr` attribute), so input reaches Svelte state. On a page,
 * `client:visible` islands are skipped (they hydrate only when scrolled into view); within a scope such as one
 * queue item, all its islands are waited for.
 */
export async function hydrated(scope: Page | Locator): Promise<void> {
  const selector = 'page' in scope ? 'astro-island[ssr]' : 'astro-island[ssr]:not([client="visible"])';
  await expect(scope.locator(selector)).toHaveCount(0);
}

/** Chooses a model in a picker the way a keyboard user does: type, go down to the first match, Enter. */
export async function pickModel(page: Page, label: string, text: string): Promise<void> {
  const picker = page.getByRole('combobox', { name: label });
  await picker.fill(text);
  await picker.press('ArrowDown');
  await picker.press('Enter');
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();  expect(results.violations.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.map(n => n.target.join(' ')) }))).toEqual([]);
}
