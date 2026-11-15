// API tokens (GLOSSARY) through Better Auth's API-key endpoints on the same origin, as the signed-in Member.
// Plain fetch like ./auth; state-changing calls send JSON, which cookie-authenticated calls require.

export interface ApiToken {
  id: string;
  name: string;
  /** The token's first characters, to tell tokens apart. */
  start: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastRequest: string | null;
}

export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
export type TokenExpiryDays = (typeof TOKEN_EXPIRY_DAYS)[number];
export const MAX_TOKEN_NAME_LENGTH = 50;

const DAY_SECONDS = 86_400;

async function call(fetcher: typeof fetch, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetcher(
    path,
    body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    // An empty or non-JSON body: the status decides.
  }
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  if (!response.ok) throw new Error(typeof record.message === 'string' ? record.message : `Request failed (${response.status})`);
  return record;
}

const asToken = (raw: Record<string, unknown>): ApiToken => ({
  id: String(raw.id),
  name: String(raw.name ?? ''),
  start: typeof raw.start === 'string' ? raw.start : null,
  createdAt: String(raw.createdAt),
  expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
  lastRequest: typeof raw.lastRequest === 'string' ? raw.lastRequest : null,
});

export async function listTokens(fetcher: typeof fetch = fetch): Promise<ApiToken[]> {
  const { apiKeys } = await call(fetcher, '/api/auth/api-key/list');
  return Array.isArray(apiKeys) ? apiKeys.map(k => asToken(k as Record<string, unknown>)) : [];
}

/** Creates a token; its key is in this response only. */
export async function createToken(name: string, days: TokenExpiryDays, fetcher: typeof fetch = fetch): Promise<{ token: ApiToken; key: string }> {
  const created = await call(fetcher, '/api/auth/api-key/create', { name, expiresIn: days * DAY_SECONDS });
  return { token: asToken(created), key: String(created.key) };
}

export async function revokeToken(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  await call(fetcher, '/api/auth/api-key/delete', { keyId: id });
}
