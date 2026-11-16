import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, hydrated, pickModel, uniqueMember } from './helpers';

// A Custom Debater (code: 'api'): the platform waits for its Turns, which the starting Member sends through the API (here with the
// dev sign-in header, as the CLI does with an API token).
test('start with a named Custom Debater, see the wait, a draft, then the Turn labelled as submitted via API', async ({ page, request }) => {
  test.setTimeout(90_000);
  const member = uniqueMember('dev-api');
  await page.setExtraHTTPHeaders({ 'x-dev-member': member });
  const motion = `API Motion ${Date.now()}`;
  await page.goto('/new');
  await hydrated(page);
  await page.getByLabel('Motion').fill(motion);
  await pickModel(page, 'Debater For', 'Custom');
  await expect(page.getByText(/debate speak <id>/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Slow Debate/ })).toHaveCount(0);
  await page.getByLabel('Nickname (optional)').fill('Atlas');
  await page.getByLabel('Model (optional, self-reported)').fill('gpt-6');
  await pickModel(page, 'Debater Against', 'Fake B');
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Start the Debate' }).click();
  await expect(page).toHaveURL(/\/debates\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;

  await expect(page.locator('.bench-model', { hasText: 'Atlas (Custom)' })).toBeVisible();
  await expect(page.locator('.bench-note', { hasText: 'self-reported model: gpt-6' })).toBeVisible();
  // Oxford: a signed-in Member states a position before reading, the starter too.
  await hydrated(page);
  await page.getByRole('radio', { name: 'For' }).check();
  await page.getByRole('button', { name: 'Cast before-vote' }).click();
  await expect(page.getByText('For is preparing a Turn via the API')).toBeAttached({ timeout: 20_000 });

  const headers = { 'content-type': 'text/plain; charset=utf-8', 'x-dev-member': member };
  const draft = await request.put(`/api/debates/${id}/turns/0/draft`, { headers, data: 'My opening, half' });
  expect(draft.status(), await draft.text()).toBe(204);
  await expect(page.locator('.speech-draft')).toContainText('My opening, half');

  const stored = await request.post(`/api/debates/${id}/turns/0`, { headers, data: 'My opening, whole. It ends here.' });
  expect(stored.status(), await stored.text()).toBe(201);
  const first = page.getByRole('log').getByRole('article').first();
  await expect(first).toContainText('My opening, whole. It ends here.', { timeout: 20_000 });
  await expect(first).toContainText('Submitted via API');
  await expect(first).not.toContainText('AI-generated');
  // The AI answers, then the Debate waits for the API Debater again.
  await expect(page.getByRole('log').getByRole('article')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText('For is preparing a Turn via the API')).toBeAttached({ timeout: 20_000 });
  // Checked last: the outcome region fades in for 0.8 s after the before-vote, which would read as low contrast.
  await expectNoAxeViolations(page);
});
