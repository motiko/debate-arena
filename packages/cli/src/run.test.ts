import { expect, test } from 'vitest';
import { run } from './run.ts';
import { BASE, debate, recordingFetch, testDeps } from './testing.ts';

const TOKEN = 'da_x';
const started = () => Response.json({ id: 'd1', panel: ['c/three'], selfJudging: false }, { status: 201 });

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

test('models lists each model with its roles', async () => {
  const models = [
    { id: 'a/one', label: 'One', roles: ['debater', 'judge'], batch: true },
    { id: 'b/two', label: 'Two', roles: ['debater'], batch: false },
  ];
  const { fetch } = recordingFetch(() => Response.json({ models }));
  const { deps, output } = testDeps({ fetch });
  expect(await run(['models'], deps)).toBe(0);
  const lines = output.out.trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^a\/one\s+One\s+debater, judge\s+batch$/);
  expect(lines[1]).toMatch(/^b\/two\s+Two\s+debater$/);
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
