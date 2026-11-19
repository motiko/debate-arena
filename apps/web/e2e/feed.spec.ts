import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, startDebate, waitComplete } from './helpers';

const word = () => `zq${Math.random().toString(36).slice(2, 8)}`;

test('searching for a word of the Motion finds that Debate and only Debates with it', async ({ page, request }) => {
  const w = word();
  const { id, motion } = await startDebate(request, { motion: `This house would ${w} the libraries` });
  await waitComplete(request, id);
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search Debates' }).fill(w);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]q=${w}`));
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([motion]);
  await expect(page.getByText('1 Debate', { exact: true })).toBeVisible();
});

test('Category, Tag and Debater are folded under More filters and apply together', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Category' })).toBeHidden();
  await page.getByText('More filters').click();
  await page.getByRole('combobox', { name: 'Category' }).selectOption('science');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/[?&]category=science/);
  await expect(page.getByRole('link', { name: 'Remove filter: Science' })).toBeVisible();
});

test('a search with no match says so and offers the whole feed', async ({ page }) => {
  await page.goto(`/?q=${word()}`);
  await expect(page.getByText('No Debates match.')).toBeVisible();
  await page.getByRole('link', { name: 'Show all Debates' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("an entry's Category and Tag lead to the Debates filed with them", async ({ page, request }) => {
  const { id, motion } = await startDebate(request);
  await waitComplete(request, id);
  const { category } = (await (await request.get(`/api/debates/${id}`)).json()) as { category: string };
  await page.goto(`/?q=${encodeURIComponent(motion)}`);
  const entry = page.getByRole('listitem').filter({ hasText: motion });
  await entry.getByRole('link', { name: 'fake', exact: true }).click();
  await expect(page).toHaveURL(/[?&]tag=fake/);
  await page.goto(`/?q=${encodeURIComponent(motion)}`);
  await page.getByRole('listitem').filter({ hasText: motion }).locator(`a[href*="category=${category}"]`).click();
  await expect(page).toHaveURL(new RegExp(`[?&]category=${category}`));
  await expect(page.getByRole('combobox', { name: 'Category', includeHidden: true })).toHaveValue(category);
  await expect(page.getByRole('heading', { level: 2, name: motion })).toBeVisible();
});

test('an active filter can be removed on its own', async ({ page }) => {
  await page.goto('/?category=science&tag=fake');
  await page.getByRole('link', { name: 'Remove filter: fake' }).click();
  await expect(page).toHaveURL(/\/\?category=science$/);
});

test('a search page is not indexed, a Category page is', async ({ page }) => {
  await page.goto(`/?q=${word()}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await page.goto('/?category=science');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/\?category=science$/);
});

test('the Debate page shows its Category and Tags, labelled as AI-generated', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  const labels = page.getByRole('list', { name: 'Category and Tags' });
  await expect(labels.getByRole('link', { name: 'fake', exact: true })).toHaveAttribute('href', '/?tag=fake');
  await expect(labels.getByText('AI-generated')).toBeVisible();
});

test('a filtered feed passes axe', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto('/?tag=fake');
  await expectNoAxeViolations(page);
});

test('a filter the feed cannot use is not shown as applied, nor kept', async ({ page }) => {
  await page.goto('/?category=cooking&kind=live');
  await expect(page.getByRole('link', { name: 'Remove filter: cooking' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Category', includeHidden: true })).toHaveValue('');
  await expect(page.getByRole('link', { name: 'Remove filter: Live Debates' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/\?kind=live$/);
});
