import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, hydrated, uniqueMember } from './helpers';

// Locally, fake batch calls answer after 2 s, so a Batch Debate completes in well under two minutes.
test('start a Batch Debate, see it is being generated, then read it when complete', async ({ page, request }) => {
  test.setTimeout(180_000);
  const member = uniqueMember('dev-batch');
  await page.setExtraHTTPHeaders({ 'x-dev-member': member });
  const motion = `Batch Motion ${Date.now()}`;
  await page.goto('/new');
  await hydrated(page);
  await page.getByLabel('Motion').fill(motion);
  await expect(page.getByText('You have 6 Quota points left today.')).toBeVisible();
  await page.getByRole('radio', { name: /Batch Debate/ }).check();
  await expect(page.locator('#start-summary')).toHaveText(/^Batch Debate · .* · 1 Quota point$/);
  await page.getByRole('button', { name: 'Start the Debate' }).click();
  await expect(page).toHaveURL(/\/debates\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByText(/being generated through batch processing/)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('log')).toHaveCount(0);
  await expectNoAxeViolations(page);

  // Another Viewer cannot see it while it runs.
  const other = await request.get(`/api/debates/${id}`);
  expect(other.status()).toBe(404);

  await expect
    .poll(async () => ((await (await request.get(`/api/debates/${id}`, { headers: { 'x-dev-member': member } })).json()) as { status: string }).status, {
      timeout: 150_000,
      intervals: [2000],
    })
    .toBe('complete');

  await page.setExtraHTTPHeaders({});
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: motion })).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'Batch Debate' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: /Verdict/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /before-vote/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Audience Result' })).toHaveCount(0);
  await expect(page.locator('.dispatch summary', { hasText: 'Show the result' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Record of this Debate' })).toBeVisible();
  await expectNoAxeViolations(page);
});
