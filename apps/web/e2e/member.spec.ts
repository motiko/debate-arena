import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, hydrated, startDebate, uniqueMember, waitComplete } from './helpers';

// A dev Member: the API honours x-dev-member while DEV_AUTH is on (local dev and tests only). The web Worker
// forwards it to the API both from the browser (/api) and from server rendering.
test.use({ extraHTTPHeaders: { 'x-dev-member': uniqueMember('e2e') } });

test('start a Debate from the form and land on its page', async ({ page }) => {
  const motion = `Form Motion ${Date.now()}`;
  await page.goto('/new');
  await hydrated(page);
  await page.getByLabel('Motion').fill(motion);
  await page.getByLabel('Debater For').selectOption('fake-a/one');
  await page.getByLabel('Debater Against').selectOption('fake-b/one');
  await page.getByRole('button', { name: 'Start the Debate' }).click();
  await expect(page).toHaveURL(/\/debates\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: motion })).toBeVisible();
});

test('before-vote, then after-vote once complete', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await hydrated(page);
  // Oxford: a signed-in Member states a position before reading.
  await expect(page.getByText('Cast your before-vote to read the Turns.', { exact: false })).toBeVisible();
  await page.getByRole('radio', { name: 'For' }).check();
  await page.getByRole('button', { name: 'Cast before-vote' }).click();
  await expect(page.getByRole('article')).toHaveCount(6);
  // Still an after-vote to cast: the Verdict at the foot waits behind "Show the result" too.
  await expect(page.locator('.verdict-winner')).toBeHidden();
  await page.getByRole('radio', { name: 'Against' }).check();
  await page.getByRole('button', { name: 'Cast after-vote' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your after-vote is recorded: Against.' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('You voted Against after the Debate.')).toBeVisible();
  await expect(page.getByText(/across 1 Member/)).toBeVisible();
  // Nothing left to vote on: the dispatch box shows the outcome without asking.
  await expect(page.locator('.dispatch .outcome-headline')).toBeVisible();
  await expect(page.locator('.dispatch summary')).toHaveCount(0);
});

test('Self-Judging warning shows when the Judge is a Debater', async ({ page }) => {
  await page.goto('/new');
  await hydrated(page);
  await page.getByLabel('Debater For').selectOption('fake-a/one');
  await page.getByLabel('Judge').selectOption('fake-a/one');
  await expect(page.getByRole('note')).toContainText('Self-Judging');
});

test('keyboard only: start a Debate', async ({ page }) => {
  const motion = `Keyboard Motion ${Date.now()}`;
  await page.goto('/new');
  await hydrated(page);
  for (let i = 0; i < 30 && !(await page.getByLabel('Motion').evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await page.keyboard.type(motion);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    if (await page.getByRole('button', { name: 'Start the Debate' }).evaluate(el => el === document.activeElement)) break;
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: motion })).toBeVisible();
});

test('long Motion and long Member name do not scroll sideways at 320px', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'x-dev-member': `m${'w'.repeat(90)}${Date.now()}` });
  const { id } = await startDebate(request, { motion: `M${'x'.repeat(299)}` });
  await waitComplete(request, id);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('button', { name: 'Cast before-vote' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test.describe('before JavaScript loads', () => {
  test.use({ javaScriptEnabled: false });

  // A form submitted before its island hydrates would reload the page and silently drop the input.
  test('the start form cannot be submitted', async ({ page }) => {
    await page.goto('/new');
    await expect(page.getByRole('button', { name: 'Start the Debate' })).toBeDisabled();
  });

  test('a vote cannot be cast', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await page.goto(`/debates/${id}`);
    await expect(page.getByRole('button', { name: 'Cast before-vote' })).toBeDisabled();
  });
});

test.describe('axe signed in', () => {
  test('start page', async ({ page }) => {
    await page.goto('/new');
    await expectNoAxeViolations(page);
  });

  test('account page', async ({ page }) => {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expectNoAxeViolations(page);
  });

  test('Debate page awaiting the before-vote', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await page.goto(`/debates/${id}`);
    await expectNoAxeViolations(page);
  });
});
