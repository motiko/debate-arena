import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectNoAxeViolations, hydrated, startDebate, uniqueMember, waitComplete } from './helpers';

// Dev Moderators: while DEV_AUTH is on, member ids starting with "dev-mod" are Moderators.
const moderator = () => ({ 'x-dev-member': uniqueMember('dev-mod') });

async function decide(request: APIRequestContext, id: string, body: Record<string, string>) {
  const res = await request.post(`/api/moderation/debates/${id}/decision`, {
    headers: { 'content-type': 'application/json', ...moderator() },
    data: body,
  });
  expect(res.status(), await res.text()).toBe(201);
}

const block = { action: 'block', ground: 'terms', groundRef: 'Terms §3 Hate', explanation: 'The Motion attacks a group of people.' };

test('a flagged Debate is not in the feed but reachable, and its starter sees why', async ({ page, request }) => {
  const starter = uniqueMember('starter');
  const { id, motion } = await startDebate(request, { motion: `Flag me ${Date.now()} [flag-test]`, member: starter });
  await waitComplete(request, id);
  await page.goto('/');
  await expect(page.getByRole('link', { name: motion })).toHaveCount(0);
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: motion })).toBeVisible();
  await expect(page.getByText(/not shown in the feed while a Moderator reviews it/)).toHaveCount(0);
  await page.setExtraHTTPHeaders({ 'x-dev-member': starter });
  await page.reload();
  await expect(page.getByText(/not shown in the feed while a Moderator reviews it/)).toBeVisible();
});

test('a Viewer can report a Debate without signing in', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await page.getByText('Report this Debate').click();
  await hydrated(page);
  await page.getByLabel('Reason').selectOption('harassment');
  await page.getByLabel('Why should a Moderator look at this Debate?').fill('It targets a named person with insults.');
  await page.getByLabel(/Your email/).fill('viewer@example.test');
  await page.getByRole('checkbox', { name: /good faith/ }).check();
  await page.getByRole('button', { name: 'Send Report' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Thank you' })).toBeVisible();
});

test('a Blocked Debate shows the statement of reasons with HTTP 410 and no Motion', async ({ page, request }) => {
  const { id, motion } = await startDebate(request);
  await waitComplete(request, id);
  await decide(request, id, block);
  const response = await page.goto(`/debates/${id}`);
  expect(response?.status()).toBe(410);
  await expect(page.getByRole('heading', { level: 1, name: 'Debate blocked' })).toBeVisible();
  await expect(page.getByText('Terms §3 Hate')).toBeVisible();
  await expect(page.getByText('The Motion attacks a group of people.')).toBeVisible();
  expect(await page.content()).not.toContain(motion);
  await expect(page).toHaveTitle('Debate blocked · Debate Arena');
});

test.describe('axe', () => {
  test('Debate page with the Report form open', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await page.goto(`/debates/${id}`);
    await page.getByText('Report this Debate').click();
    await hydrated(page);
    await expectNoAxeViolations(page);
  });

  test('Blocked page', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await decide(request, id, block);
    await page.goto(`/debates/${id}`);
    await expectNoAxeViolations(page);
  });
});
