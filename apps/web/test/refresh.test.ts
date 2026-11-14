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
  document.body.innerHTML = `${page('Live now', '<p>The Panel gives its Verdict when the Debate ends.</p><button>Vote</button>')}
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
