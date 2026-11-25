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
  // Just finished: Audience voting is open for a week, so the outcome waits (spec: the hybrid rule).
  await expect(entry).toContainText('Voting open');
  await expect(entry).not.toContainText(/carried|defeated/i);
});

test('the legal links are full-size touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const link of await page.locator('.legal-nav a').all()) expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

test('debate page shows Turns, Verdict and AI labels', async ({ page, request }) => {
  const { id, motion } = await startDebate(request, { aiVoters: true });
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page).toHaveTitle(`${motion} · Debate Arena`);
  await expect(page.getByRole('heading', { level: 1, name: motion })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(6);
  // Voting is open and this Viewer has no after-vote: the outcome is folded until asked for.
  await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
  await expect(page.getByRole('heading', { name: /Verdict/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /AI Audience Result/ })).toBeVisible();
  // The Judge's Rubric Scores, with what each criterion means (the fake Judge: For 7, 6, 6, 8; Against 6, 7, 7, 7).
  const scores = page.getByRole('table', { name: 'Rubric Scores' });
  await expect(scores.getByRole('columnheader')).toHaveText(['Criterion', 'For', 'Against']);
  const first = scores.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Argument strength/ }) });
  await expect(first.getByRole('cell')).toHaveText(['7', '6']);
  await expect(scores).toContainText("Engages directly with the other Side's strongest points.");
  // The table fits a narrow phone without scrolling the page sideways.
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(scores).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  // Every Turn, the Verdict and the AI Audience Result carry the label.
  expect(await page.getByText('AI-generated', { exact: true }).count()).toBeGreaterThanOrEqual(8);
});

test('the Verdict says whether the Motion stands, how sure, the crux, the checked claims and each Ballot', async ({ page, request }) => {
  const { id } = await startDebate(request, { panel: ['fake-c/one', 'fake-d/one', 'fake-a/one'] });
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
  const verdict = page.locator('section.verdict');
  // The fake Judges all find the same way, "likely", with one disputed claim.
  await expect(verdict.locator('.verdict-winner')).toHaveText(/^The Motion (stands|falls)$/);
  await expect(verdict.locator('.verdict-confidence')).toContainText('Likely');
  await expect(verdict.locator('.crux')).toContainText('Crux: Whether a fake argument can settle a real question.');
  const claims = verdict.getByRole('region', { name: 'Claims checked' });
  await expect(claims.getByRole('listitem')).toHaveCount(1);
  await expect(claims.getByRole('listitem')).toContainText('Disputed');
  await expect(claims.getByRole('listitem')).toContainText('A fake claim, made for local development.');
  await expect(claims).toContainText('Checked against the Judges’ own knowledge, without sources.');
  await expect(verdict).toContainText(/Panel: (3–0|0–3)/);
  await expect(verdict).toContainText('The Rubric Scores rate how each Side argued; the Verdict is on the Motion, and they may differ.');
  await verdict.getByText('Each Judge’s Ballot').click();
  await expect(verdict.locator('.ballot')).toHaveCount(3);
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expectNoAxeViolations(page);
});

test('the Audience Result says it measures persuasion, not who is right', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
  await expect(page.locator('.audiences')).toContainText('It measures persuasion: who moved the audience, not who is right.');
});

test('the AI Audience Result says it measures persuasion too', async ({ page, request }) => {
  const { id } = await startDebate(request, { aiVoters: true });
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
  await expect(page.locator('section.division').filter({ has: page.getByRole('heading', { name: /AI Audience Result/ }) })).toContainText('not who is right');
});

test('the AI Audience Result sits beside the Audience Result in the same panel', async ({ page, request }) => {
  const { id } = await startDebate(request, { aiVoters: true });
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
  const panels = page.locator('.audiences > section.division');
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0).getByRole('heading', { level: 2 })).toHaveText('Audience Result');
  const ai = panels.nth(1);
  await expect(ai.getByRole('heading', { level: 2 })).toContainText('AI Audience Result');
  await expect(ai.getByText('AI-generated', { exact: true })).toBeVisible();
  for (const panel of [panels.nth(0), ai]) await expect(panel.locator('.swing, .swing-empty')).toHaveCount(1);
});

test('debate page reads without JavaScript', async ({ browser, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('article')).toHaveCount(6);
  // The folded outcome is a plain <details>: it opens without JavaScript.
  await page.locator('#outcome > summary').click();
  await expect(page.getByRole('heading', { name: /Verdict/ })).toBeVisible();
  await context.close();
});

test('while voting is open, one "Show the result" opens every outcome on the page', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  const headline = page.locator('.dispatch .outcome-headline');
  await expect(headline).toBeHidden();
  await expect(page.locator('.verdict-winner')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Audience Result' })).toBeHidden();
  await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
  await expect(headline).toHaveText(/carries the Motion|defeats the Motion|Split decision/);
  await expect(page.locator('.verdict-winner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audience Result' })).toBeVisible();
});

test('a signed-out Viewer is asked to sign in once, with the reason', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page.locator('main').getByRole('button', { name: /sign in/i })).toHaveCount(1);
  await expect(page.locator('main').getByRole('button', { name: 'Sign in to vote' })).toBeVisible();
  await expect(page.locator('.dispatch')).toContainText('Members vote before and after the Debate.');
});

test('one Copy link button, after the Motion, and a way on to more Debates', async ({ page, request }) => {
  const { id } = await startDebate(request);
  await waitComplete(request, id);
  await page.goto(`/debates/${id}`);
  await expect(page.getByRole('button', { name: 'Copy link to this Debate' })).toHaveCount(1);
  await expect(page.locator('.debate-band').getByRole('button', { name: 'Copy link to this Debate' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'More Debates on the order paper' }).getByRole('link', { name: 'More Debates on the order paper' })).toHaveAttribute('href', '/');
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

test("the account is one avatar button whose panel shows the name, Quota, the account page and Sign out", async ({ page }) => {
  const member = `panel-${Date.now()}`;
  await page.setExtraHTTPHeaders({ 'x-dev-member': member });
  await page.goto('/');
  const avatar = page.getByRole('button', { name: 'Your account, 24 Quota points left today' });
  const panel = page.locator('#account-panel');
  await expect(panel).toBeHidden();
  await avatar.click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(member);
  await expect(panel).toContainText('24 Quota points left today');
  // One lozenge per 4 points.
  await expect(panel.locator('.lozenge:not(.spent)')).toHaveCount(6);
  await expect(panel.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/account');
  await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(avatar).toBeFocused();
});

test('hovering the avatar with a mouse opens the account panel, and leaving closes it', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-dev-member': `hover-${Date.now()}` });
  await page.goto('/');
  const panel = page.locator('#account-panel');
  await page.locator('.avatar-button').hover();
  await expect(panel).toBeVisible();
  await page.locator('main').hover({ position: { x: 5, y: 300 } });
  await expect(panel).toBeHidden();
});

test("a signed-in header stays at two rows on a phone, a Moderator's too, with the account as the nav's last item", async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-dev-member': `dev-mod-rows-${Date.now()}` });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const items = nav.locator(':is(a, button):visible');
  await expect(items.last()).toHaveAccessibleName(/^Your account, /);
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
  const summary = page.locator('#outcome > summary');
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

  test('dark mode page heading band (404)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
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
    await page.locator('.dispatch').getByRole('link', { name: 'Show the result' }).click();
    await expectNoAxeViolations(page);
    await page.setExtraHTTPHeaders({ 'x-dev-member': `dark-${Date.now()}` });
    await page.goto('/new');
    await expect(page.getByRole('combobox', { name: 'Debater For' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
