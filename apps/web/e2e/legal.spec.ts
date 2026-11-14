import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

test('the footer links to Impressum, privacy policy and terms', async ({ page }) => {
  await page.goto('/');
  const legal = page.getByRole('navigation', { name: 'Legal' });
  for (const [name, path] of [
    ['Impressum', '/impressum'],
    ['Privacy policy', '/privacy'],
    ['Terms of use', '/terms'],
  ] as const) {
    await expect(legal.getByRole('link', { name })).toHaveAttribute('href', path);
  }
});

test('legal pages show the operator', async ({ page }) => {
  await page.goto('/impressum');
  await expect(page.getByRole('heading', { level: 1, name: 'Impressum' })).toBeVisible();
  // Placeholders until launch; the release check refuses a production deploy while they remain.
  await expect(page.getByText('REPLACE_ME_OPERATOR_NAME').first()).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Who is responsible' })).toBeVisible();
  await expect(page.getByText(/REPLACE_ME_OPERATOR_EMAIL/)).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
});

for (const path of ['/impressum', '/privacy', '/terms']) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expectNoAxeViolations(page);
  });
}
