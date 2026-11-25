import { FakeSocket } from '@debate-arena/api-client/testing';
import { beforeEach, expect, test, vi } from 'vitest';
import { follow } from './follow.ts';
import { printable } from './terminal.ts';
import { BASE, debate, recordingFetch, testDeps } from './testing.ts';

beforeEach(() => FakeSocket.reset());

const turn = (slotIndex: number, text = `Turn ${slotIndex} text.`) => ({
  phaseIndex: Math.floor(slotIndex / 2),
  side: slotIndex % 2 === 0 ? ('for' as const) : ('against' as const),
  text,
  truncated: false,
});
const running = (turns: number) => debate({ status: 'running', verdict: null, turns: Array.from({ length: turns }, (_, i) => turn(i)) });
const verdict = { winner: 'for' as const, reasoning: 'Better evidence.', scores: [], judges: ['c/three'] };

/** Answers each GET with the next Debate in `views` (the last one repeats). */
function views(...list: object[]) {
  return recordingFetch(() => Response.json(list.length > 1 ? list.shift() : list[0]));
}

function setup(fetchViews: ReturnType<typeof views>, isTTY = false) {
  const { deps, output } = testDeps({ fetch: fetchViews.fetch, WebSocketImpl: FakeSocket as unknown as typeof WebSocket, isTTY });
  const result = follow('d1', { ...deps, base: BASE, liveOptions: { retryMs: 1, pingMs: 60_000 } });
  return { output, result };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const count = (text: string, part: string) => text.split(part).length - 1;

test('a Turn written before the socket opens is printed once', async () => {
  const { output } = setup(views(running(1)));
  const socket = FakeSocket.last;
  socket.open();
  socket.emit({ type: 'turn', slotIndex: 0, turn: turn(0) });
  socket.emit({ type: 'turn', slotIndex: 1, turn: turn(1) });
  await settle();
  expect(count(output.out, 'Turn 0 text.')).toBe(1);
  expect(count(output.out, 'Turn 1 text.')).toBe(1);
  expect(output.out.indexOf('Turn 0 text.')).toBeLessThan(output.out.indexOf('Turn 1 text.'));
});

test('after a reconnect, missed Turns are fetched', async () => {
  // Loaded at the start, again when the socket first opens, and again after the reconnect.
  const fetchViews = views(running(2), running(2), running(3));
  const { output } = setup(fetchViews);
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.drop();
  await settle();
  FakeSocket.last.open();
  await settle();
  expect(fetchViews.requests).toHaveLength(3);
  expect(count(output.out, 'Turn 2 text.')).toBe(1);
  expect(count(output.out, 'Turn 0 text.')).toBe(1);
});

test('a Turn written after loading but before the first open is fetched when the socket opens', async () => {
  const { output } = setup(views(running(1), running(2)));
  await settle();
  FakeSocket.last.open();
  await settle();
  expect(count(output.out, 'Turn 1 text.')).toBe(1);
});

test('complete prints a missed last Turn and Verdict before the vote link', async () => {
  const done = debate({ status: 'complete', turns: [turn(0), turn(1)], verdict });
  const { output, result } = setup(views(running(1), running(1), done));
  await settle();
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  expect(await result).toBe(0);
  expect(count(output.out, 'Turn 1 text.')).toBe(1);
  expect(count(output.out, 'Verdict: For wins')).toBe(1);
  expect(output.out.indexOf('Turn 1 text.')).toBeLessThan(output.out.indexOf('Read and vote:'));
});

test('a Turn beyond the next one fetches the gap', async () => {
  const { output } = setup(views(running(1), running(3)));
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'turn', slotIndex: 2, turn: turn(2) });
  await settle();
  expect(count(output.out, 'Turn 1 text.')).toBe(1);
  expect(count(output.out, 'Turn 2 text.')).toBe(1);
});

test('with a TTY, drafts stream and the Turn completes the line', async () => {
  const { output } = setup(views(running(0)), true);
  FakeSocket.last.open();
  await settle();
  const before = output.out.length;
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'Hello' });
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'Hello world' });
  FakeSocket.last.emit({ type: 'turn', slotIndex: 0, turn: turn(0, 'Hello world') });
  await settle();
  expect(output.out.slice(before)).toBe('\n── Opening · For · a/one ──\nHello world\n');
});

test('a draft cleared for a retry starts the Turn again', async () => {
  const { output } = setup(views(running(0)), true);
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'False start' });
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: '' });
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'Second go' });
  FakeSocket.last.emit({ type: 'turn', slotIndex: 0, turn: turn(0, 'Second go') });
  await settle();
  expect(output.out).toContain('False start\n[retrying]\nSecond go\n');
});

test('without a TTY, only finished Turns are printed', async () => {
  const { output } = setup(views(running(0)), false);
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'Partial' });
  await settle();
  expect(output.out).not.toContain('Partial');
  FakeSocket.last.emit({ type: 'turn', slotIndex: 0, turn: turn(0, 'Partial and whole.') });
  await settle();
  expect(count(output.out, 'Partial')).toBe(1);
  expect(output.out).not.toContain('\x1b');
});

test('control characters in live Turns and drafts are never printed', async () => {
  const { output } = setup(views(running(0)), true);
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'A\x1b[2J' });
  FakeSocket.last.emit({ type: 'turn', slotIndex: 0, turn: turn(0, 'A\x1b[2J and more') });
  FakeSocket.last.emit({ type: 'failed', reason: 'oops\x1b]0;x\x07' });
  await settle();
  expect(output.out + output.err).toBe(printable(output.out + output.err));
  expect(output.out).toContain('A[2J and more');
});

test('verdict and complete print the Verdict and vote link and return 0', async () => {
  const { output, result } = setup(views(running(2)));
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'verdict', verdict });
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  expect(await result).toBe(0);
  expect(output.out).toContain('Verdict: For wins (c/three)\nBetter evidence.');
  expect(output.out.trimEnd().endsWith(`Read and vote: ${BASE}/debates/d1`)).toBe(true);
  expect(FakeSocket.last.readyState).toBe(3);
});

test('failed prints the reason and returns 1', async () => {
  const { output, result } = setup(views(running(1)));
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'failed', reason: 'The model did not answer' });
  expect(await result).toBe(1);
  expect(output.err).toContain('The model did not answer');
});

test('blocked returns 1 and closes the socket', async () => {
  const { output, result } = setup(views(running(1)));
  FakeSocket.last.open();
  await settle();
  FakeSocket.last.emit({ type: 'blocked' });
  expect(await result).toBe(1);
  expect(output.err).toContain('Blocked by a Moderator');
  expect(FakeSocket.last.readyState).toBe(3);
});

test('a Debate already complete is rendered without connecting', async () => {
  const { output, result } = setup(views(debate()));
  expect(await result).toBe(0);
  expect(output.out).toContain('Verdict: For wins');
  await vi.waitFor(() => expect(FakeSocket.instances.every(s => s.readyState === 3)).toBe(true));
});

test('giving up on the live connection returns 1 with a way to resume', async () => {
  const fetchViews = views(running(1));
  const { deps, output } = testDeps({ fetch: fetchViews.fetch, WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
  const result = follow('d1', { ...deps, base: BASE, liveOptions: { retryMs: 1, maxRetries: 1, pingMs: 60_000 } });
  await settle();
  FakeSocket.last.drop();
  await settle();
  FakeSocket.last.drop();
  expect(await result).toBe(1);
  expect(output.err).toContain('debate show d1 --follow');
});
