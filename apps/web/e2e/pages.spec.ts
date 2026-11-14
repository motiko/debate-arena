import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, startDebate, waitComplete } from './helpers';

test('home lists completed Debates', async ({ page, request }) => {
  const { id, motion } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Debates' })).toBeVisible();
  await expect(page.getByRole('link', { name: motion })).toHaveAttribute('href', `/debates/${id}`);
});

test('the order paper names the benches and the outcome', async ({ page, request }) => {
  const { id, motion } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto('/');
  const entry = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: motion }) });
  await expect(entry).toContainText('Fake A for, Fake B against');
  await expect(entry).toContainText(/Carried|Defeated/);
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

test('a finished Debate keeps its result behind "Show the result"', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  const headline = page.locator('.dispatch .outcome-headline');
  await expect(headline).toBeHidden();
  await page.locator('.dispatch summary', { hasText: 'Show the result' }).click();
  await expect(headline).toHaveText(/carries the Motion|defeats the Motion|Split decision/);
});

test('a 300-character Motion fits a phone screen', async ({ page, request }) => {
  const word = 'Interconnectedness';
  const motion = `This house believes ${Array.from({ length: 20 }, () => word).join(' ')}`.slice(0, 300);
  const { id } = await startDebate(request, { motion });
  await waitComplete(request, id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(motion);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('header controls are readable on the band for a signed-in Member', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-dev-member': `band-${Date.now()}` });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCSS('color', 'rgb(242, 245, 241)');
});

test('a signed-in header stays at two rows on a phone, with a visible account label', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-dev-member': `rows-${Date.now()}` });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');
  await expect(page.locator('.site-header').getByRole('link', { name: /^Your account/ })).toBeVisible();
  // Two rows of 44px targets plus padding; a third row would push it past 130px.
  expect((await page.locator('.site-header').boundingBox())?.height).toBeLessThan(130);
});

test('the Motion and the dispatch box are inside main, where "Skip to content" lands', async ({ page, request }) => {
  const { id, motion } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page.locator('main h1')).toHaveText(motion);
  await expect(page.locator('main .dispatch')).toHaveCount(1);
});

test('"Show the result" stays focusable once open, offering to hide it', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  const summary = page.locator('.dispatch summary');
  await summary.click();
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText('Hide the result', { useInnerText: true });
});

test('the Record names the Judge without guessing who chose it', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page.locator('.record')).not.toContainText('picked by the platform');
});

test('the page loads its serif from this site only', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', request => urls.push(request.url()));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const origin = new URL(page.url()).origin;
  expect(urls.filter(url => new URL(url).origin !== origin)).toEqual([]);
  // fonts.check() is also true when no such face exists, so look for a loaded face by name.
  const loaded = await page.evaluate(() =>
    [...document.fonts].some(face => face.family.replaceAll('"', '').startsWith('Source Serif 4') && face.status === 'loaded'),
  );
  expect(loaded).toBe(true);
});

test('the header sits in the green band', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-header')).toHaveCSS('background-color', 'rgb(29, 92, 69)');
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

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('home, a revealed Debate and the start page pass axe', async ({ page, request }) => {
    const { id } = await startDebate(request, { aiVoters: true });
    await waitComplete(request, id);
    await page.goto('/');
    await expectNoAxeViolations(page);
    await page.goto(`/debates/${id}`);
    await page.locator('.dispatch summary', { hasText: 'Show the result' }).click();
    await expectNoAxeViolations(page);
    await page.setExtraHTTPHeaders({ 'x-dev-member': `dark-${Date.now()}` });
    await page.goto('/new');
    await expect(page.getByLabel('Debater For')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
