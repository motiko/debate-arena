import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, hydrated, pickModel, startDebate, uniqueMember, waitComplete } from './helpers';

// A dev Member: the API honours x-dev-member while DEV_AUTH is on (local dev and tests only). The web Worker
// forwards it to the API both from the browser (/api) and from server rendering.
test.use({ extraHTTPHeaders: { 'x-dev-member': uniqueMember('e2e') } });

test('start a Debate from the form and land on its page', async ({ page }) => {
  const motion = `Form Motion ${Date.now()}`;
  await page.goto('/new');
  await hydrated(page);
  await page.getByLabel('Motion').fill(motion);
  // The list of matches, open, passes axe too.
  await page.getByRole('combobox', { name: 'Debater For' }).fill('fake');
  await expect(page.getByRole('option').first()).toBeVisible();
  await expectNoAxeViolations(page);
  await pickModel(page, 'Debater For', 'Fake A');
  await pickModel(page, 'Debater Against', 'Fake B');
  await expect(page.locator('#start-cost')).toHaveText(/^\d+ Quota points · you have 24 left today$/);
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
  await expect(page.getByRole('group', { name: 'Where do you stand now?' })).toBeVisible();
  await page.getByRole('radio', { name: 'Against' }).check();
  await page.getByRole('button', { name: 'Cast after-vote' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your after-vote is recorded: Against.' })).toHaveCount(1);
  // The after-vote opens the outcome in place, everywhere on the page.
  await expect(page.locator('.verdict-winner')).toBeVisible();
  await expect(page.locator('.dispatch .outcome-headline')).toBeVisible();
  await page.reload();
  await expect(page.getByText('You voted Against after the Debate.')).toBeVisible();
  await expect(page.getByText(/across 1 Member/)).toBeVisible();
  // Nothing left to vote on: the dispatch box shows the outcome without asking.
  await expect(page.locator('.dispatch .outcome-headline')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show the result' })).toHaveCount(0);
  await expect(page.locator('details#outcome')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Where do you stand now?' })).toHaveCount(0);
});

test('the starter of a live Debate votes before, follows it, and is asked again in place at the end', async ({ page }) => {
  const member = uniqueMember('live');
  await page.setExtraHTTPHeaders({ 'x-dev-member': member });
  const { id } = await startDebate(page.request, { paced: true, member });
  await page.goto(`/debates/${id}`);
  await hydrated(page);
  // The before-vote does not hide that the Debate is running.
  await expect(page.locator('.dispatch')).toContainText('Live now');
  await expect(page.getByRole('group', { name: 'Where do you stand?' })).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __sameLoad: boolean }).__sameLoad = true));
  await page.getByRole('radio', { name: 'For' }).check();
  await page.getByRole('button', { name: 'Cast before-vote' }).click();
  // The Turns come in place, and the reader goes on from them rather than from the top of the page.
  await expect(page.getByRole('log')).toBeVisible();
  await expect(page.locator('#turns')).toBeFocused();
  await expect(page.getByText('The Debate is over.')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole('group', { name: 'Where do you stand now?' })).toBeVisible();
  await expect(page.locator('.dispatch')).not.toContainText('Live now');
  await page.getByRole('radio', { name: 'Against' }).check();
  await page.getByRole('button', { name: 'Cast after-vote' }).click();
  await expect(page.locator('.verdict-winner')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
});

test('Self-Judging warning shows when the Judge is a Debater', async ({ page }) => {
  await page.goto('/new');
  await hydrated(page);
  await pickModel(page, 'Debater For', 'Fake A');
  await pickModel(page, 'Judge', 'Fake A');
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

  // Dev Members have no Better Auth session, so creating a token is covered by the island's unit tests.
  test('the account page has an API tokens section', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 2, name: 'API tokens' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create token' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('Debate page awaiting the before-vote', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await page.goto(`/debates/${id}`);
    await expectNoAxeViolations(page);
  });
});
