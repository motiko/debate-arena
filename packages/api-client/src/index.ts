import type { AppType, DebateSummary, PublicDebate } from '@debate-arena/api/app-type';
import { hc } from 'hono/client';

export type { DebateEvent } from '@debate-arena/api/events';
export type { DebateSummary, PublicDebate };

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
