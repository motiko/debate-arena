import { afterEach, expect, test, vi } from 'vitest';
import { refreshRegions } from '../src/lib/refresh';

afterEach(() => (document.body.innerHTML = ''));

const page = (dispatch: string, outcome: string, announce = '') => `
  <div data-region="benches" data-announce="${announce}"><p>${dispatch}</p></div>
  <section><p>Floor</p></section>
  <div data-region="outcome">${outcome}</div>`;

function serve(html: string, status = 200) {
  return vi.fn(async () => new Response(html, { status, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
}

function setUp() {
  document.body.innerHTML = `${page('Live now', '<p>The Judge gives the Verdict when the Debate ends.</p><button>Vote</button>')}
    <p id="debate-announcer" role="status"></p>`;
}

test('swaps each region for its fresh render and leaves the rest alone', async () => {
  setUp();
  const floor = document.querySelector('section');
  const fetcher = serve(page('Where do you stand now?', '<h2 data-focus tabindex="-1">Verdict</h2>', 'Where do you stand now?'));
  expect(await refreshRegions({ fetcher, url: '/debates/d1' })).toBe(true);
  expect(fetcher).toHaveBeenCalledWith('/debates/d1', expect.objectContaining({ cache: 'no-store' }));
  expect(document.body).not.toHaveTextContent('Live now');
  expect(document.body).not.toHaveTextContent('when the Debate ends');
  expect(document.querySelector('[data-region="benches"]')).toHaveTextContent('Where do you stand now?');
  expect(document.querySelector('section')).toBe(floor);
  // Marked so the arrival can be drawn (once, calmly).
  expect(document.querySelector('[data-region="outcome"]')).toHaveAttribute('data-arrived');
});

test('announces the fresh regions, after what the caller has to say', async () => {
  setUp();
  await refreshRegions({ fetcher: serve(page('x', '', 'Fake A carries the Motion.')), url: '/d', prefix: 'Your after-vote is recorded: For.' });
  expect(document.getElementById('debate-announcer')).toHaveTextContent('Your after-vote is recorded: For. Fake A carries the Motion.');
});

test('says only what the caller has to say when the regions are not to announce themselves', async () => {
  setUp();
  await refreshRegions({ fetcher: serve(page('x', '', 'Where do you stand now?')), url: '/d', prefix: 'Your before-vote is recorded: For.', announce: false });
  expect(document.getElementById('debate-announcer')).toHaveTextContent(/^Your before-vote is recorded: For\.$/);
});

test('moves focus into the fresh render when asked, so it is not lost with the old one', async () => {
  setUp();
  document.querySelector('button')?.focus();
  await refreshRegions({ fetcher: serve(page('x', '<h2 data-focus tabindex="-1">Verdict</h2>')), url: '/d', focus: true });
  expect(document.activeElement).toHaveTextContent('Verdict');
});

test('leaves the page as it is when the fresh render fails', async () => {
  setUp();
  expect(await refreshRegions({ fetcher: serve('oops', 500), url: '/d' })).toBe(false);
  expect(document.body).toHaveTextContent('Live now');
  const offline = vi.fn(async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
  expect(await refreshRegions({ fetcher: offline, url: '/d' })).toBe(false);
  expect(await refreshRegions({ fetcher: serve('<p>No regions here</p>'), url: '/d' })).toBe(false);
  expect(document.body).toHaveTextContent('Live now');
});

test('keeps focus that was inside a swapped region: on the matching control of the fresh render', async () => {
  document.body.innerHTML = `<div data-region="benches"><a id="to-vote" href="#v">Vote</a></div><p id="debate-announcer"></p>`;
  document.getElementById('to-vote')?.focus();
  await refreshRegions({ fetcher: serve('<div data-region="benches"><p>Over</p><a id="to-vote" href="#v">Vote again</a></div>'), url: '/d' });
  expect(document.activeElement?.id).toBe('to-vote');
  expect(document.activeElement?.textContent).toBe('Vote again');
});

test('matches a control by name when it has no id', async () => {
  document.body.innerHTML = `<div data-region="outcome"><input type="radio" name="stance" value="for"></div>`;
  document.querySelector('input')?.focus();
  await refreshRegions({ fetcher: serve('<div data-region="outcome"><p>Now</p><input type="radio" name="stance" value="against"></div>'), url: '/d' });
  expect(document.activeElement).toHaveAttribute('name', 'stance');
});

test('falls back to the fresh region itself when the focused control is gone', async () => {
  setUp();
  document.querySelector('button')?.focus();
  await refreshRegions({ fetcher: serve(page('x', '<p>Verdict</p>')), url: '/d' });
  const region = document.querySelector('[data-region="outcome"]');
  expect(document.activeElement).toBe(region);
  expect(region).toHaveAttribute('tabindex', '-1');
});

test('leaves focus alone when it was outside the swapped regions', async () => {
  document.body.innerHTML = `<button id="outside">Menu</button>${page('Live now', '<button>Vote</button>')}`;
  document.getElementById('outside')?.focus();
  await refreshRegions({ fetcher: serve(page('x', '<p>Verdict</p>')), url: '/d' });
  expect(document.activeElement).toHaveAttribute('id', 'outside');
});

test('moves focus to a chosen element of the fresh render', async () => {
  setUp();
  document.querySelector('button')?.focus();
  await refreshRegions({
    fetcher: serve(page('x', '<section id="turns" tabindex="-1">Turns</section><h2 data-focus tabindex="-1">Verdict</h2>')),
    url: '/d',
    focus: '#turns',
  });
  expect(document.activeElement?.id).toBe('turns');
});

const withFloor = (floor: string, outcome: string) =>
  `<div data-region="turns" data-on-request><p>${floor}</p></div><div data-region="outcome"><p>${outcome}</p></div>`;

test('swaps a region marked on-request only when the caller names it', async () => {
  document.body.innerHTML = withFloor('Live floor', 'Pending');
  const live = document.querySelector('[data-region="turns"]');
  await refreshRegions({ fetcher: serve(withFloor('Server floor', 'Verdict')), url: '/d' });
  // A live floor (or speeches the reader opened) stays as it is when only the outcome changed.
  expect(document.querySelector('[data-region="turns"]')).toBe(live);
  expect(document.body).toHaveTextContent('Verdict');
  await refreshRegions({ fetcher: serve(withFloor('Server floor', 'Verdict')), url: '/d', include: ['turns'] });
  expect(document.body).toHaveTextContent('Server floor');
});
