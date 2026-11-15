// Test doubles for the CLI: a recording fetch, captured output, and Debates to render.
import type { PublicDebate } from '@debate-arena/api-client';
import type { CliDeps } from './run.ts';

export const BASE = 'https://debate-arena-web.motiko.workers.dev';

export type Responder = (request: Request) => Response | Promise<Response>;

/** A fetch that records each request and answers with `respond`. */
export function recordingFetch(respond: Responder) {
  const requests: Request[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init) as Request;
    requests.push(request.clone() as Request);
    return respond(request);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/** CliDeps with captured output; `env` and `fetch` default to no token and a fetch that fails the test. */
export function testDeps(overrides: Partial<CliDeps> = {}) {
  const output = { out: '', err: '' };
  const deps: CliDeps = {
    env: {},
    fetch: (async () => {
      throw new Error('unexpected request');
    }) as typeof fetch,
    WebSocketImpl: globalThis.WebSocket,
    out: text => {
      output.out += text;
    },
    err: text => {
      output.err += text;
    },
    isTTY: false,
    stdin: new ReadableStream<Uint8Array>({ start: controller => controller.close() }),
    ...overrides,
  };
  return { deps, output };
}

export function debate(overrides: Partial<PublicDebate> = {}): PublicDebate {
  return {
    id: 'd1',
    kind: 'live',
    status: 'complete',
    motion: 'Pineapple belongs on pizza',
    format: {
      id: 'classic',
      name: 'Classic',
      phases: [
        { name: 'Opening', order: ['for', 'against'], maxWords: 300, maxSeconds: 120 },
        { name: 'Rebuttal', order: ['against', 'for'], maxWords: 200, maxSeconds: 90 },
      ],
    },
    debaters: { for: { kind: 'ai', model: 'a/one' }, against: { kind: 'ai', model: 'b/two' } },
    panel: ['c/three'],
    selfJudging: false,
    aiVoters: [],
    aiVotersShareDebaterModel: false,
    turns: [
      { phaseIndex: 0, side: 'for', text: 'Sweet and savoury.', truncated: false },
      { phaseIndex: 0, side: 'against', text: 'Fruit has no place here.', truncated: false },
    ],
    verdict: { winner: 'for', reasoning: 'Better evidence.', judges: ['c/three'] },
    aiAudience: null,
    awaiting: null,
    createdAt: '2026-11-15T10:00:00.000Z',
    completedAt: '2026-11-15T10:05:00.000Z',
    turnsHidden: false,
    myVote: null,
    audienceResult: null,
    visibility: 'listed',
    mine: false,
    ...overrides,
  } as PublicDebate;
}
