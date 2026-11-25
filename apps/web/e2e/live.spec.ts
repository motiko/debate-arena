import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, startDebate } from './helpers';

// The local queue runs one Debate at a time, and a paced Debate takes ~10 s: each test here shares one Debate's
// worth of waiting with the others, so new checks join these tests rather than starting another paced Debate.
test('live Turns appear as they are written, each growing in its seat first', async ({ page, request }) => {
  const { id } = await startDebate(request, { paced: true });
  await page.goto(`/debates/${id}`);
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  const atLoad = await log.getByRole('article').count();
  expect(atLoad).toBeLessThanOrEqual(1);
  // Marks this page load: a reload would lose it.
  await page.evaluate(() => ((window as unknown as { __sameLoad: boolean }).__sameLoad = true));
  // A speech grows as it is written; it is for the eye only, and the seat says who is speaking.
  const draft = page.locator('.speech-draft');
  await expect(draft).toBeVisible({ timeout: 20_000 });
  const first = (await draft.textContent())!.length;
  await expect.poll(async () => (await draft.textContent())?.length ?? 0).toBeGreaterThan(first);
  await expect(page.getByText(/(For|Against) is speaking/)).toBeAttached();
  // While it runs, the page names what the Judge will score.
  await expect(page.getByText('The Judge scores each Side on: Argument strength, Rebuttal quality, Evidence, Clarity.')).toBeVisible();
  await expect(log.getByRole('article')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText('Live: new Turns appear as they are written.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
  // The end, in place: nothing stale stays, and the folded outcome arrives without a reload.
  await expect(page.getByText('The Debate is over.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#outcome > summary')).toBeVisible();
  await expect(page.locator('.dispatch')).not.toContainText('Live now');
  await expect(page.getByText('The Judge gives the Verdict when the Debate ends.')).toHaveCount(0);
  await expect(log.getByRole('article')).toHaveCount(6);
  await expect(page.locator('.record dl')).toContainText('Finished');
  expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
});

test('axe: live Debate page, with a speech being written', async ({ page, request }) => {
  const { id } = await startDebate(request, { paced: true });
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('log')).toBeVisible();
  await expect(page.locator('.speech-draft')).toBeVisible({ timeout: 20_000 });
  await expectNoAxeViolations(page);
});
