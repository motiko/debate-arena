import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, startDebate, waitComplete } from './helpers';

test('home lists completed Debates', async ({ page, request }) => {
  const { id, motion } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Debates' })).toBeVisible();
  await expect(page.getByRole('link', { name: motion })).toHaveAttribute('href', `/debates/${id}`);
});

test('debate page shows Turns, Verdict and AI labels', async ({ page, request }) => {
  const { id, motion } = await startDebate(request, { aiVoters: true });
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page).toHaveTitle(`${motion} · Debate Arena`);
  await expect(page.getByRole('heading', { level: 1, name: motion })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: /Verdict/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /AI Audience Result/ })).toBeVisible();
  // Every Turn, the Verdict and the AI Audience Result carry the label.
  expect(await page.getByText('AI-generated', { exact: true }).count()).toBeGreaterThanOrEqual(8);
});

test('debate page reads without JavaScript', async ({ browser, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('article')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: /Verdict/ })).toBeVisible();
  await context.close();
});

test('unknown Debate id responds 404', async ({ page }) => {
  const response = await page.goto('/debates/no-such-debate');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

test('long unbroken Motion does not scroll sideways at 320px', async ({ page, request }) => {
  const { id } = await startDebate(request, { motion: `M${'x'.repeat(299)}` });
  await waitComplete(request, id);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/debates/${id}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('Motion text with markup renders literally', async ({ page, request }) => {
  const motion = `<img src=x onerror="window.__pwned=1"> ${Date.now()}`;
  const { id } = await startDebate(request, { motion });
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(motion);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test.describe('axe', () => {
  test('home', async ({ page }) => {
    await page.goto('/');
    await expectNoAxeViolations(page);
  });

  test('Debate page', async ({ page, request }) => {
    const { id } = await startDebate(request, { aiVoters: true });
    await waitComplete(request, id);
    await page.goto(`/debates/${id}`);
    await expectNoAxeViolations(page);
  });

  test('start page signed out', async ({ page }) => {
    await page.goto('/new');
    await expectNoAxeViolations(page);
  });

  test('account page signed out', async ({ page }) => {
    await page.goto('/account');
    await expectNoAxeViolations(page);
  });

  test('404', async ({ page }) => {
    await page.goto('/debates/no-such-debate');
    await expectNoAxeViolations(page);
  });

  test('dark mode Debate page', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/debates/${id}`);
    await expectNoAxeViolations(page);
  });
});
