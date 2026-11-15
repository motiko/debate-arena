import { FakeSocket } from '@debate-arena/api-client/testing';
import { expect, test, vi } from 'vitest';
import { run } from './run.ts';
import { BASE, debate, recordingFetch, testDeps } from './testing.ts';

const TOKEN = 'da_x';
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function stdinOf(pieces: string[], pauseMs = 0): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= pieces.length) return controller.close();
      if (pauseMs) await sleep(pauseMs);
      controller.enqueue(encoder.encode(pieces[i++]!));
    },
  });
}

const awaiting = { slotIndex: 2, side: 'for' as const, deadline: '2026-11-15T12:10:00.000Z' };
const turn = { phaseIndex: 1, side: 'for', text: 'One two three.', truncated: false };

function platform(view = debate({ status: 'running', verdict: null, awaiting })) {
  return recordingFetch(request => {
    if (request.method === 'GET') return Response.json(view);
    if (request.method === 'PUT') return new Response(null, { status: 204 });
    return Response.json({ slotIndex: 2, turn }, { status: 201 });
  });
}

test('speak sends the awaited Turn from stdin, showing drafts while it reads', async () => {
  const { fetch, requests } = platform();
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, stdin: () => stdinOf(['One ', 'two ', 'three.'], 350) });
  expect(await run(['speak', 'd1'], deps)).toBe(0);
  const post = requests.find(r => r.method === 'POST')!;
  expect(post.url).toBe(`${BASE}/api/debates/d1/turns/2`);
  expect(post.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  expect(post.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(await post.text()).toBe('One two three.');
  const methods = requests.map(r => r.method);
  expect(methods.filter(m => m === 'PUT').length).toBeGreaterThanOrEqual(1);
  expect(methods.lastIndexOf('PUT')).toBeLessThan(methods.indexOf('POST'));
  expect(requests.find(r => r.method === 'PUT')?.url).toBe(`${BASE}/api/debates/d1/turns/2/draft`);
  expect(output.out).toBe('Turn 2 stored (3 words)\n');
});

test('speak --slot skips reading the Debate', async () => {
  const { fetch, requests } = platform();
  const { deps } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, stdin: () => stdinOf(['Hi.']) });
  expect(await run(['speak', 'd1', '--slot', '4'], deps)).toBe(0);
  expect(requests.some(r => r.method === 'GET')).toBe(false);
  expect(requests.find(r => r.method === 'POST')?.url).toBe(`${BASE}/api/debates/d1/turns/4`);
});

test('speak to a Debate that is not waiting fails without sending', async () => {
  const { fetch, requests } = platform(debate({ status: 'running', verdict: null, awaiting: null }));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, stdin: () => stdinOf(['Hi.']) });
  expect(await run(['speak', 'd1'], deps)).toBe(1);
  expect(output.err).toBe('This Debate is not waiting for an API Turn\n');
  expect(requests.some(r => r.method === 'POST')).toBe(false);
});

test("speak shows the API's refusal and returns 1", async () => {
  const { fetch } = recordingFetch(request =>
    request.method === 'POST' ? Response.json({ error: 'This Debate is not waiting for Turn 4' }, { status: 409 }) : new Response(null, { status: 204 }),
  );
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, stdin: () => stdinOf(['Hi.']) });
  expect(await run(['speak', 'd1', '--slot', '4'], deps)).toBe(1);
  expect(output.err).toBe('This Debate is not waiting for Turn 4\n');
});

test('speak without a token explains where to get one', async () => {
  const { deps, output } = testDeps({ stdin: () => stdinOf(['Hi.']) });
  expect(await run(['speak', 'd1'], deps)).toBe(1);
  expect(output.err).toContain('Set DEBATE_ARENA_TOKEN');
});

test('only speak opens stdin: an opened stdin that never ends would keep show from exiting', async () => {
  const { fetch } = recordingFetch(() => Response.json(debate()));
  const stdin = vi.fn(() => stdinOf([]));
  const { deps } = testDeps({ fetch, stdin });
  expect(await run(['show', 'd1', '--json'], deps)).toBe(0);
  expect(stdin).not.toHaveBeenCalled();
});

test('start --for api seats an API Debater', async () => {
  const { fetch, requests } = recordingFetch(() => Response.json({ id: 'd1', panel: ['c/three'], selfJudging: false }, { status: 201 }));
  const { deps } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  await run(['start', 'M', '--for', 'api', '--against', 'b/two', '--detach'], deps);
  expect(await requests[0]?.json()).toMatchObject({ debaters: { for: 'api', against: 'b/two' } });
});

test('start --dry-run prices the line-up and starts nothing', async () => {
  const { fetch, requests } = recordingFetch(() =>
    Response.json({ budgetMicroUsd: 47_816, quotaPoints: 4, quotaRemaining: 20, slowAvailable: true, panel: ['c/three'], selfJudging: false }),
  );
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch });
  expect(await run(['start', 'M', '--for', 'a/one', '--against', 'b/two', '--dry-run'], deps)).toBe(0);
  expect(requests.map(r => r.url)).toEqual([`${BASE}/api/debates/quote`]);
  expect(output.out).toBe('4 Quota points (20 left today) · worst case $0.05\n');
});

test('models --search lists only the models matching every word', async () => {
  const models = [
    { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', roles: ['debater', 'judge'], batch: true },
    { id: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra', roles: ['debater', 'judge'], batch: true },
  ];
  const { fetch } = recordingFetch(() => Response.json({ models }));
  const { deps, output } = testDeps({ fetch });
  expect(await run(['models', '--search', 'haiku anthropic'], deps)).toBe(0);
  expect(output.out).toContain('anthropic/claude-haiku-5.5');
  expect(output.out).not.toContain('terra');
});

test('following a Debate says when it waits for an API Turn', async () => {
  FakeSocket.reset();
  const view = debate({ status: 'running', verdict: null, turns: [], debaters: { for: { kind: 'api' }, against: { kind: 'ai', model: 'b/two' } } });
  const { fetch } = recordingFetch(() => Response.json(view));
  const { deps, output } = testDeps({ fetch, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
  const code = run(['show', 'd1', '--follow'], deps);
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'awaiting', slotIndex: 0, deadline: '2026-11-15T12:10:00.000Z' });
  FakeSocket.last.emit({ type: 'failed', reason: 'x' });
  await code;
  expect(output.out).toContain("Waiting for For's Turn via the API until 12:10 UTC");
  expect(output.out).toContain('For: Custom Debater');
});

/** A running Debate waiting for its Custom For bench's first Turn; `forSeat` and `turns` vary it. */
const firstTurnView = (forSeat: object = { kind: 'api' }, turns: object[] = []) =>
  debate({
    status: 'running',
    verdict: null,
    turns: turns as never,
    awaiting: { slotIndex: turns.length, side: 'for', deadline: '2026-11-15T12:10:00.000Z' },
    debaters: { for: forSeat as never, against: { kind: 'ai', model: 'b/two' } },
  });

test('speak --name and --model name the Custom Debater with its Turn', async () => {
  const { fetch, requests } = platform(firstTurnView());
  const { deps } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, stdin: () => stdinOf(['Hi.']) });
  expect(await run(['speak', 'd1', '--slot', '0', '--name', 'Atlas', '--model', 'gpt 6'], deps)).toBe(0);
  expect(requests.find(r => r.method === 'POST')?.url).toBe(`${BASE}/api/debates/d1/turns/0?name=Atlas&model=gpt+6`);
});

/** Runs speak with these flags, with stdin that records whether it was opened. */
async function speakRefused(view: ReturnType<typeof debate>, flags: string[]) {
  const { fetch, requests } = platform(view);
  const stdin = vi.fn(() => stdinOf(['A whole speech.']));
  const { deps, output } = testDeps({ env: { DEBATE_ARENA_TOKEN: TOKEN }, fetch, stdin });
  const code = await run(['speak', 'd1', ...flags], deps);
  return { code, err: output.err, stdinOpened: stdin.mock.calls.length > 0, sent: requests.filter(r => r.method !== 'GET').length };
}

const LATE = "A Custom Debater's name and model can be set only at start or with its first Turn\n";

test('a bad --name is refused before the speech is read', async () => {
  expect(await speakRefused(firstTurnView(), ['--name', 'x'.repeat(41)])).toEqual({
    code: 1,
    err: 'Custom Debater name must be 1–40 characters, without control characters\n',
    stdinOpened: false,
    sent: 0,
  });
  expect((await speakRefused(firstTurnView(), ['--model', 'gpt‮6'])).stdinOpened).toBe(false);
});

test('a --name for a bench already named differently is refused before the speech is read', async () => {
  expect(await speakRefused(firstTurnView({ kind: 'api', name: 'Boreas' }), ['--name', 'Atlas'])).toEqual({ code: 1, err: LATE, stdinOpened: false, sent: 0 });
});

test('a --name after the bench has spoken is refused before the speech is read', async () => {
  const spoken = [{ phaseIndex: 0, side: 'for', text: 'First.', truncated: false }, { phaseIndex: 0, side: 'against', text: 'Reply.', truncated: false }];
  expect(await speakRefused(firstTurnView({ kind: 'api' }, spoken), ['--name', 'Atlas'])).toEqual({ code: 1, err: LATE, stdinOpened: false, sent: 0 });
});

test('the same --name sent again on a later Turn goes through', async () => {
  const spoken = [{ phaseIndex: 0, side: 'for', text: 'First.', truncated: false }, { phaseIndex: 0, side: 'against', text: 'Reply.', truncated: false }];
  const { code, stdinOpened } = await speakRefused(firstTurnView({ kind: 'api', name: 'Atlas' }, spoken), ['--name', 'Atlas']);
  expect({ code, stdinOpened }).toEqual({ code: 0, stdinOpened: true });
});
