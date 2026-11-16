import { FakeSocket } from '@debate-arena/api-client/testing';
import { expect, test, vi } from 'vitest';
import { run } from './run.ts';
import { printable } from './terminal.ts';
import { BASE, debate, recordingFetch, testDeps } from './testing.ts';

const TOKEN = 'da_x';
const started = () => Response.json({ id: 'd1', panel: ['c/three'], selfJudging: false }, { status: 201 });

test('start --for custom with a name and model seats a named Custom Debater', async () => {
  const { fetch, requests } = recordingFetch(started);
  const { deps } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  await run(['start', 'M', '--for', 'custom', '--for-name', 'Atlas', '--for-model', 'gpt-6', '--against', 'b/two', '--detach'], deps);
  expect(await requests[0]?.json()).toMatchObject({ debaters: { for: { kind: 'custom', name: 'Atlas', model: 'gpt-6' }, against: 'b/two' } });
});

test('a name or model for a model seat is refused before anything is sent', async () => {
  const { fetch, requests } = recordingFetch(started);
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['start', 'M', '--for', 'a/one', '--for-name', 'X', '--against', 'b/two', '--detach'], deps)).toBe(1);
  expect(output.err).toBe('--for-name and --for-model need --for custom\n');
  expect(requests).toEqual([]);
});

test('start sends the token and the setup', async () => {
  const { fetch, requests } = recordingFetch(started);
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  const code = await run(['start', 'Pineapple belongs on pizza', '--for', 'a/one', '--against', 'b/two', '--detach'], deps);
  expect(code).toBe(0);
  expect(requests[0]?.method).toBe('POST');
  expect(requests[0]?.url).toBe(`${BASE}/api/debates`);
  expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  expect(await requests[0]?.json()).toEqual({ motion: 'Pineapple belongs on pizza', debaters: { for: 'a/one', against: 'b/two' }, aiVoters: false, batch: false });
  expect(output.out).toContain('Started d1');
  expect(output.out).toContain(`${BASE}/debates/d1`);
});

test('start follows the Debate live unless detached', async () => {
  FakeSocket.reset();
  const { fetch } = recordingFetch(request => (request.method === 'POST' ? started() : Response.json(debate({ status: 'running', verdict: null, turns: [] }))));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
  const code = run(['start', 'M', '--for', 'a/one', '--against', 'b/two'], deps);
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  expect(FakeSocket.last.url).toBe('wss://debate-arena-web.motiko.workers.dev/api/debates/d1/live');
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  expect(await code).toBe(0);
  expect(output.out).toContain('Started d1');
  expect(output.out).toContain('Read and vote:');
});

test('show --follow follows a running Debate', async () => {
  FakeSocket.reset();
  const { fetch } = recordingFetch(() => Response.json(debate({ status: 'running', verdict: null })));
  const { deps } = testDeps({ fetch, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
  const code = run(['show', 'd1', '--follow'], deps);
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'failed', reason: 'x' });
  expect(await code).toBe(1);
});

test('start passes the Panel, AI Voters and Batch options', async () => {
  const { fetch, requests } = recordingFetch(started);
  const { deps } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  await run(['start', 'M', '--for', 'a/one', '--against', 'b/two', '--panel', 'c/three, d/four', '--ai-voters', '--batch'], deps);
  expect(await requests[0]?.json()).toEqual({
    motion: 'M',
    debaters: { for: 'a/one', against: 'b/two' },
    panel: ['c/three', 'd/four'],
    aiVoters: true,
    batch: true,
  });
});

test('start without DEBATE_ARENA_TOKEN explains where to get one', async () => {
  const { fetch, requests } = recordingFetch(started);
  const { deps, output } = testDeps({ fetch });
  expect(await run(['start', 'M', '--for', 'a/one', '--against', 'b/two'], deps)).toBe(1);
  expect(output.err).toContain(`${BASE}/account`);
  expect(requests).toHaveLength(0);
});

test('a refused token says it may be revoked or expired', async () => {
  const { fetch } = recordingFetch(() => Response.json({ error: 'Sign in to start a Debate' }, { status: 401 }));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['start', 'M', '--for', 'a/one', '--against', 'b/two', '--detach'], deps)).toBe(1);
  expect(output.err).toMatch(/revoked or expired/);
  expect(output.err).toContain(`${BASE}/account`);
});

test('API errors are shown and return 1', async () => {
  const { fetch } = recordingFetch(() => Response.json({ error: 'Not enough Quota left today' }, { status: 429 }));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['start', 'M', '--for', 'a/one', '--against', 'b/two', '--detach'], deps)).toBe(1);
  expect(output.err).toContain('Not enough Quota left today');
});

test('DEBATE_ARENA_URL changes the base', async () => {
  const { fetch, requests } = recordingFetch(started);
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN, DEBATE_ARENA_URL: 'http://localhost:4321/' }, fetch });
  await run(['start', 'M', '--for', 'a/one', '--against', 'b/two', '--detach'], deps);
  expect(requests[0]?.url).toBe('http://localhost:4321/api/debates');
  expect(output.out).toContain('http://localhost:4321/debates/d1');
});

test('start --json prints id, url, panel and selfJudging only', async () => {
  const { fetch } = recordingFetch(started);
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['start', 'M', '--for', 'a/one', '--against', 'b/two', '--json'], deps)).toBe(0);
  expect(JSON.parse(output.out)).toEqual({ id: 'd1', url: `${BASE}/debates/d1`, panel: ['c/three'], selfJudging: false });
});

test('whoami shows the Member and their Quota', async () => {
  const { fetch, requests } = recordingFetch(() => Response.json({ id: 'u1', name: 'Ada', image: null, quotaRemaining: 4, isModerator: false }));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['whoami'], deps)).toBe(0);
  expect(requests[0]?.url).toBe(`${BASE}/api/me`);
  expect(output.out).toBe('Signed in as Ada. 4 Quota points left today.\n');
});

test('models lists each model with its price and roles', async () => {
  const models = [
    { id: 'a/one', label: 'One', roles: ['debater', 'judge'], batch: true, inputPerMTokUsd: 1.5, outputPerMTokUsd: 4.5 },
    { id: 'b/two', label: 'Two', roles: ['debater'], batch: false, inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5 },
  ];
  const { fetch } = recordingFetch(() => Response.json({ models }));
  const { deps, output } = testDeps({ fetch });
  expect(await run(['models'], deps)).toBe(0);
  const lines = output.out.trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^a\/one\s+One\s+\$1\.50 \/ \$4\.50 per 1M tokens\s+debater, judge\s+batch$/);
  expect(lines[1]).toMatch(/^b\/two\s+Two\s+\$0\.10 \/ \$0\.50 per 1M tokens\s+debater$/);
});

test('show renders a completed Debate with Verdict and vote link, without credentials', async () => {
  const { fetch, requests } = recordingFetch(() => Response.json(debate()));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['show', 'd1'], deps)).toBe(0);
  expect(requests[0]?.url).toBe(`${BASE}/api/debates/d1`);
  expect(requests[0]?.headers.get('authorization')).toBeNull();
  expect(output.out).toContain('Verdict: For wins');
  expect(output.out).toContain(`Read and vote: ${BASE}/debates/d1`);
});

test('show of a Blocked Debate says so and returns 1', async () => {
  const blocked = { id: 'd1', blocked: { decidedAt: '2026-11-15', ground: 'terms', groundRef: '§3', explanation: 'Hate speech.' } };
  const { fetch } = recordingFetch(() => Response.json(blocked, { status: 410 }));
  const { deps, output } = testDeps({ fetch });
  expect(await run(['show', 'd1'], deps)).toBe(1);
  expect(output.err).toContain('Blocked by a Moderator');
  expect(output.err).toContain('Hate speech.');
});

test('unknown commands and flags return 2 with usage', async () => {
  for (const argv of [['dance'], ['start', 'M', '--for', 'a', '--against', 'b', '--loud'], ['start', 'M', '--for', 'a'], ['show']]) {
    const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN } });
    expect(await run(argv, deps), argv.join(' ')).toBe(2);
    expect(output.err).toContain('Usage: debate');
  }
});

test('help prints usage and returns 0', async () => {
  for (const argv of [[], ['help'], ['--help']]) {
    const { deps, output } = testDeps();
    expect(await run(argv, deps)).toBe(0);
    expect(output.out).toContain('Usage: debate');
  }
});

test('control characters from the server are never printed', async () => {
  const hostile = '\x1b]0;pwned\x07Motion\x1b[2J with \x9b31m colour\ttab';
  const { fetch } = recordingFetch(() => Response.json(debate({ motion: hostile })));
  const { deps, output } = testDeps({ fetch });
  await run(['show', 'd1'], deps);
  expect(output.out).toBe(printable(output.out));
  expect(output.out).toContain('Motion[2J with 31m colour\ttab');
  const failing = recordingFetch(() => Response.json({ error: 'Bad \x1b[31mthing' }, { status: 400 }));
  const second = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch: failing.fetch });
  await run(['start', 'M', '--for', 'a', '--against', 'b', '--detach'], second.deps);
  expect(second.output.err).not.toContain('\x1b');
});

test('the token never appears in output', async () => {
  const cases: [string[], () => Response | Promise<Response>][] = [
    [['start', 'M', '--for', 'a', '--against', 'b', '--detach'], () => Response.json({ error: 'nope' }, { status: 401 })],
    [['start', 'M', '--for', 'a', '--against', 'b', '--detach'], () => Response.json({ error: `bad token ${TOKEN}` }, { status: 500 })],
    [['start', 'M', '--for', 'a', '--against', 'b', '--detach'], () => Promise.reject(new Error(`fetch failed for ${BASE} with ${TOKEN}`))],
    [['start', 'M', '--for', 'a', '--against', 'b', '--json'], started],
    [['whoami', '--json'], () => Response.json({ id: 'u1', name: TOKEN, image: null, quotaRemaining: 4, isModerator: false })],
  ];
  for (const [argv, respond] of cases) {
    const { fetch } = recordingFetch(respond);
    const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
    await run(argv, deps);
    expect(output.out + output.err, argv.join(' ')).not.toContain(TOKEN);
  }
});
