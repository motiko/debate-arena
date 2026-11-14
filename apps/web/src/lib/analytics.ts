// Cookieless page views (ADR 0005): counted on the server in Workers Analytics Engine, with no client script, no
// cookie and nothing that identifies a person — no IP, no user agent, no full referrer, no ids in paths.

const BOT = /bot|crawl|spider|slurp|lighthouse|headless/i;

/** A page's path with ids replaced, so Debates are counted together and no id is stored. */
function pathTemplate(pathname: string): string {
  return pathname.replace(/^\/(debates|blocked)\/[^/]+/, '/$1/:id');
}

function referrerHost(request: Request): string {
  const referer = request.headers.get('referer');
  if (!referer) return '';
  try {
    const host = new URL(referer).host;
    return host === new URL(request.url).host ? '' : host;
  } catch {
    return '';
  }
}

/** The data point for one HTML page view, or null when the response is not a page someone viewed. */
export function pageViewPoint(request: Request, response: Response): AnalyticsEngineDataPoint | null {
  const { pathname } = new URL(request.url);
  if (request.method !== 'GET' || pathname === '/api' || pathname.startsWith('/api/')) return null;
  if (response.status >= 400 || !response.headers.get('content-type')?.startsWith('text/html')) return null;
  const cf = (request as Request & { cf?: { country?: string; botManagement?: { verifiedBot?: boolean } } }).cf;
  const bot = cf?.botManagement?.verifiedBot === true || BOT.test(request.headers.get('user-agent') ?? '');
  const path = pathTemplate(pathname);
  return { blobs: [path, cf?.country ?? '??', referrerHost(request), bot ? 'bot' : 'human'], doubles: [1], indexes: [path] };
}
