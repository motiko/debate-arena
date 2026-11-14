import { pageViewPoint } from './lib/analytics';

/**
 * Web and API share one origin: every `/api` request, WebSocket upgrades included, goes to the API Worker
 * through its service binding unchanged (URL, cookies, body); everything else is an Astro page, whose view is
 * counted (cookielessly) when the Analytics Engine binding exists.
 */
export async function routeRequest(
  request: Request,
  env: { API: Fetcher; ANALYTICS?: AnalyticsEngineDataset },
  astro: (request: Request) => Promise<Response>,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api' || pathname.startsWith('/api/')) return env.API.fetch(request);
  const response = await astro(request);
  if (env.ANALYTICS) {
    const point = pageViewPoint(request, response);
    if (point) env.ANALYTICS.writeDataPoint(point);
  }
  return response;
}
