import type { AppType, BlockedDebate, DebateSummary, PublicDebate } from '@debate-arena/api/app-type';
import { hc } from 'hono/client';

export type { DebateEvent } from '@debate-arena/api/events';
export type { BlockedDebate, DebateSummary, PublicDebate };
export { connectLive, liveUrl, type LiveHandlers, type LiveOptions, type LiveStatus } from './live.ts';

export interface ApiClientOptions {
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

/** Typed client for the Debate Arena API, shared by every Venue (web, CLI, bots). */
export function createApiClient(baseUrl: string, options: ApiClientOptions = {}) {
  return hc<AppType>(baseUrl, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Whether a model matches a search: every whitespace-separated word, ignoring case, appears in its label, id or
 * provider. An empty search matches everything. Shared by the web picker and `debate models --search`.
 */
export function matchesSearch(model: { id: string; label: string }, query: string, provider: string): boolean {
  const haystack = `${model.label}\n${model.id}\n${provider}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => haystack.includes(word));
}

/** The base without trailing slashes, in linear time (a `/\/+$/` regex is quadratic on a base full of slashes). */
function trimSlashes(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === '/') end -= 1;
  return baseUrl.slice(0, end);
}

const turnUrl = (baseUrl: string, debateId: string, slot: number) =>
  `${trimSlashes(baseUrl)}/api/debates/${encodeURIComponent(debateId)}/turns/${slot}`;

const textHeaders = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'text/plain; charset=utf-8' });

/**
 * Submits an API Debater's Turn for a slot, as the Member whose API token this is. A stream is sent as it is read
 * (`duplex: 'half'`), though the platform's edge may hand it on only once complete: use sendDraft to show it live.
 */
export function submitTurn(
  baseUrl: string,
  token: string,
  debateId: string,
  slot: number,
  body: string | ReadableStream<Uint8Array>,
  fetcher: typeof fetch = fetch,
  /** A Custom Debater's nickname and self-reported model, which its first Turn may give. */
  identity: { name?: string | undefined; model?: string | undefined } = {},
): Promise<Response> {
  const query = new URLSearchParams();
  if (identity.name) query.set('name', identity.name);
  if (identity.model) query.set('model', identity.model);
  const search = query.size > 0 ? `?${query}` : '';
  return fetcher(`${turnUrl(baseUrl, debateId, slot)}${search}`, {
    method: 'POST',
    headers: textHeaders(token),
    body,
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  } as RequestInit);
}

/** Shows Viewers an API Debater's Turn so far (the whole text so far). Best-effort: the stored Turn replaces it. */
export function sendDraft(baseUrl: string, token: string, debateId: string, slot: number, text: string, fetcher: typeof fetch = fetch): Promise<Response> {
  return fetcher(`${turnUrl(baseUrl, debateId, slot)}/draft`, { method: 'PUT', headers: textHeaders(token), body: text });
}
