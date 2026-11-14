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
  await hydrated(page.locator('details.report'));
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

test('a Viewer watching a live Debate is taken off it when it is Blocked', async ({ page, request }) => {
  const { id, motion } = await startDebate(request, { slow: true });
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('log')).toBeVisible();
  await hydrated(page);
  await decide(request, id, block);
  await expect(page.getByRole('heading', { level: 1, name: 'Debate blocked' })).toBeVisible({ timeout: 15_000 });
  expect(await page.content()).not.toContain(motion);
  const stopped = await (await request.get(`/api/debates/${id}`)).json();
  expect(stopped).toMatchObject({ id, blocked: { groundRef: 'Terms §3 Hate' } });
});

test.describe('Moderator queue', () => {
  test('a Moderator relists a flagged Debate back into the feed', async ({ page, request }) => {
    const { id, motion } = await startDebate(request, { motion: `Relist me ${Date.now()} [flag-test]` });
    await waitComplete(request, id);
    await page.setExtraHTTPHeaders(moderator());
    await page.goto('/moderation');
    await expect(page.getByRole('link', { name: 'Moderation' })).toBeVisible();
    const item = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: motion }) });
    await expect(item.getByText(/Flagged by the AI screen: Hate/)).toBeVisible();
    await item.scrollIntoViewIfNeeded();
    await hydrated(item);
    await item.getByRole('button', { name: 'Relist' }).click();
    await expect(item.getByRole('status')).toContainText('Relisted');
    await page.goto('/');
    await expect(page.getByRole('link', { name: motion })).toBeVisible();
  });

  test('a Moderator blocks a Debate and it is gone', async ({ page, request }) => {
    const { id, motion } = await startDebate(request, { motion: `Block me ${Date.now()} [flag-test]` });
    await waitComplete(request, id);
    await page.setExtraHTTPHeaders(moderator());
    await page.goto('/moderation');
    const item = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: motion }) });
    await item.scrollIntoViewIfNeeded();
    await hydrated(item);
    await item.getByRole('radio', { name: 'Breach of the terms of use' }).check();
    await item.getByLabel('Reference').fill('Terms §3 Hate');
    await item.getByLabel('Explanation for the author').fill('The Motion attacks a group of people.');
    await item.getByRole('button', { name: 'Block' }).click();
    await expect(item.getByRole('status')).toContainText('Blocked');
    expect((await page.goto(`/debates/${id}`))?.status()).toBe(410);
  });

  test('a Member without the role gets 403 on /moderation', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-dev-member': uniqueMember('dev-member') });
    const response = await page.goto('/moderation');
    expect(response?.status()).toBe(403);
    await expect(page.getByText('Only Moderators can see this page.')).toBeVisible();
  });
});

test.describe('axe', () => {
  test('Moderator queue', async ({ page, request }) => {
    const { id } = await startDebate(request, { motion: `Queue ${Date.now()} [flag-test]` });
    await waitComplete(request, id);
    await page.setExtraHTTPHeaders(moderator());
    await page.goto('/moderation');
    await expectNoAxeViolations(page);
  });

  test('Debate page with the Report form open', async ({ page, request }) => {
    const { id } = await startDebate(request);
    await waitComplete(request, id);
    await page.goto(`/debates/${id}`);
    await page.getByText('Report this Debate').click();
    await hydrated(page.locator('details.report'));
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
