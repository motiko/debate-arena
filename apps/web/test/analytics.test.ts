import { expect, test, vi } from 'vitest';
import { pageViewPoint } from '../src/lib/analytics';
import { routeRequest } from '../src/route';

const html = (status = 200) => new Response('<html></html>', { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

function request(url: string, init: { method?: string; ua?: string; referer?: string; country?: string } = {}) {
  const r = new Request(url, {
    method: init.method ?? 'GET',
    headers: { 'user-agent': init.ua ?? 'Mozilla/5.0 (Linux; Android 14)', ...(init.referer ? { referer: init.referer } : {}) },
  });
  Object.defineProperty(r, 'cf', { value: { country: init.country ?? 'DE' } });
  return r;
}

test('counts an HTML page view with a path template', () => {
  expect(pageViewPoint(request('https://arena.test/debates/0c9f-1234', { referer: 'https://news.example/post/1' }), html())).toEqual({
    blobs: ['/debates/:id', 'DE', 'news.example', 'human'],
    doubles: [1],
    indexes: ['/debates/:id'],
  });
  expect(pageViewPoint(request('https://arena.test/'), html())?.blobs?.[0]).toBe('/');
  expect(pageViewPoint(request('https://arena.test/blocked/abc'), html())?.blobs?.[0]).toBe('/blocked/:id');
});

test('marks crawlers and Lighthouse as bots', () => {
  expect(pageViewPoint(request('https://arena.test/', { ua: 'Googlebot/2.1' }), html())?.blobs?.[3]).toBe('bot');
  expect(pageViewPoint(request('https://arena.test/', { ua: 'Chrome-Lighthouse' }), html())?.blobs?.[3]).toBe('bot');
});

test('does not count API calls, assets, other methods or errors', () => {
  expect(pageViewPoint(request('https://arena.test/api/debates'), html())).toBeNull();
  expect(pageViewPoint(request('https://arena.test/favicon.svg'), new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))).toBeNull();
  expect(pageViewPoint(request('https://arena.test/', { method: 'POST' }), html())).toBeNull();
  expect(pageViewPoint(request('https://arena.test/nope'), html(404))).toBeNull();
});

test('stores no IP, user agent or full referrer', () => {
  const r = request('https://arena.test/new?ref=1', { ua: 'Mozilla/5.0 UniqueAgent/123', referer: 'https://news.example/secret?token=x' });
  const point = JSON.stringify(pageViewPoint(r, html()));
  expect(point).not.toContain('UniqueAgent');
  expect(point).not.toContain('secret');
  expect(point).not.toContain('ref=1');
});

test('the Worker writes one data point per page, and none without the binding', async () => {
  const writeDataPoint = vi.fn();
  const api = { fetch: vi.fn() } as unknown as Fetcher;
  await routeRequest(request('https://arena.test/'), { API: api, ANALYTICS: { writeDataPoint } as unknown as AnalyticsEngineDataset }, async () => html());
  expect(writeDataPoint).toHaveBeenCalledTimes(1);
  await expect(routeRequest(request('https://arena.test/'), { API: api }, async () => html())).resolves.toBeInstanceOf(Response);
});
