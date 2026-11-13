/**
 * Web and API share one origin: every `/api` request, WebSocket upgrades included, goes to the API Worker
 * through its service binding unchanged (URL, cookies, body); everything else is an Astro page.
 */
export function routeRequest(
  request: Request,
  env: { API: Fetcher },
  astro: (request: Request) => Promise<Response>,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api' || pathname.startsWith('/api/')) return env.API.fetch(request);
  return astro(request);
}
