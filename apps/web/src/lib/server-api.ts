import { createApiClient, type ApiClient } from '@debate-arena/api-client';

// Only these identify the Viewer to the API; nothing else from the incoming request is passed on.
// `x-dev-member` is honoured by the API only while DEV_AUTH is "true" (local dev and tests).
const IDENTITY_HEADERS = ['cookie', 'x-dev-member'] as const;

/** A typed API client for server-side rendering: calls go through the API service binding as the Viewer. */
export function serverApi(request: Request, api: Fetcher): ApiClient {
  const headers: Record<string, string> = {};
  for (const name of IDENTITY_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return createApiClient(new URL(request.url).origin, {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => api.fetch(new Request(input, init))) as typeof fetch,
    headers,
  });
}

export interface Me {
  id: string;
  name: string;
  image: string | null;
  quotaRemaining: number;
}

export interface Viewer {
  me: Me | null;
  /** Refreshed session cookies from the API, for the page response (keeps active Members signed in). */
  setCookies: string[];
}

/**
 * The signed-in Member (null when signed out), for the header on every page. Never throws: if the API cannot
 * say who is signed in, the page still renders, signed out, rather than every page failing.
 */
export async function loadViewer(client: ApiClient): Promise<Viewer> {
  try {
    const response = await client.api.me.$get();
    if (response.status === 401) return { me: null, setCookies: [] };
    if (!response.ok) throw new Error(`GET /api/me failed (${response.status})`);
    return { me: (await response.json()) as Me, setCookies: response.headers.getSetCookie() };
  } catch (error) {
    console.error('Could not load the signed-in Member; rendering signed out', error);
    return { me: null, setCookies: [] };
  }
}
