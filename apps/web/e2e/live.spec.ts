import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, startDebate } from './helpers';

test('live Turns appear as they are written', async ({ page, request }) => {
  const { id } = await startDebate(request, { slow: true });
  await page.goto(`/debates/${id}`);
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  const atLoad = await log.getByRole('article').count();
  expect(atLoad).toBeLessThanOrEqual(1);
  // Marks this page load: a reload would lose it.
  await page.evaluate(() => ((window as unknown as { __sameLoad: boolean }).__sameLoad = true));
  await expect(log.getByRole('article')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText('Live: new Turns appear as they are written.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
  // The end, in place: nothing stale stays, and the folded outcome arrives without a reload.
  await expect(page.getByText('The Debate is over.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#outcome > summary')).toBeVisible();
  await expect(page.locator('.dispatch')).not.toContainText('Live now');
  await expect(page.getByText('The Panel gives its Verdict when the Debate ends.')).toHaveCount(0);
  await expect(log.getByRole('article')).toHaveCount(6);
  expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
});

test('axe: live Debate page', async ({ page, request }) => {
  const { id } = await startDebate(request, { slow: true });
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('log')).toBeVisible();
  await expectNoAxeViolations(page);
});
