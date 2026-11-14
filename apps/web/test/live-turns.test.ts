import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';
import LiveTurns from '../src/islands/LiveTurns.svelte';
import { mergeTurns } from '../src/lib/debate';
import { FakeSocket } from './fake-socket';

beforeEach(() => FakeSocket.reset());

const turn = (i: number) => ({ phaseIndex: i < 2 ? 0 : 1, side: i % 2 === 0 ? ('for' as const) : ('against' as const), text: `Turn ${i}`, truncated: false });
const order: ('for' | 'against')[] = ['for', 'against'];
const format = { phases: [{ name: 'Opening', order, maxWords: 300, maxSeconds: 60 }, { name: 'Closing', order, maxWords: 300, maxSeconds: 60 }] };
const impl = FakeSocket as unknown as typeof WebSocket;
const speakers = { for: 'Fake A', against: 'Fake B' };

test('a running Debate shows who speaks next', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl });
  expect(screen.getByText('Against speaks next')).toBeInTheDocument();
});

function debateFetcher(turns: ReturnType<typeof turn>[], status = 'running') {
  return vi.fn(async () => Response.json({ status, turns })) as unknown as typeof fetch;
}

test('mergeTurns places Turns by slot and ignores duplicates', () => {
  expect(mergeTurns([turn(0)], [{ slotIndex: 1, turn: turn(1) }, { slotIndex: 0, turn: turn(0) }, { slotIndex: 1, turn: turn(1) }])).toEqual([turn(0), turn(1)]);
});

test('mergeTurns stops at a gap', () => {
  expect(mergeTurns([turn(0)], [{ slotIndex: 2, turn: turn(2) }])).toEqual([turn(0)]);
  // Once the missing slot arrives, the later one is kept.
  expect(mergeTurns([turn(0)], [{ slotIndex: 2, turn: turn(2) }, { slotIndex: 1, turn: turn(1) }])).toEqual([turn(0), turn(1), turn(2)]);
});

test('merges a refetch with live Turns without duplicates', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0), turn(1)]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'turn', slotIndex: 1, turn: turn(1) });
  await vi.waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  await new Promise(r => setTimeout(r, 0));
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByText('Turn 1')).toBeInTheDocument();
});

test('shows live Turns in an announced region', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl });
  const region = screen.getByRole('log');
  expect(region).toHaveAttribute('aria-live', 'polite');
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'turn', slotIndex: 0, turn: turn(0) });
  await vi.waitFor(() => expect(region).toHaveTextContent('Turn 0'));
});

test('reconnects after the socket closes', async () => {
  vi.useFakeTimers();
  try {
    render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl });
    FakeSocket.last.open();
    FakeSocket.last.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.instances).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

test('announces completion without reloading', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  expect(await screen.findByRole('link', { name: /show the verdict/i })).toHaveAttribute('href', '/debates/d1');
  expect(screen.getByText(/the debate is complete/i)).toBeInTheDocument();
});

test('says so when the Debate fails', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'failed', reason: 'The Debate could not be completed.' });
  expect(await screen.findByText('This Debate could not be completed.')).toBeInTheDocument();
});

test('a Block removes the Turns and reloads to the Blocked page', async () => {
  const reload = vi.fn();
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl, reload });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'blocked' });
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

test('a 410 while catching up also reloads', async () => {
  const reload = vi.fn();
  const fetcher = vi.fn(async () => Response.json({ id: 'd1', blocked: {} }, { status: 410 })) as unknown as typeof fetch;
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher, WebSocketImpl: impl, reload });
  FakeSocket.last.open();
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

test('notices a Debate that finished before the socket opened', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([turn(0), turn(1)], 'complete'), WebSocketImpl: impl });
  FakeSocket.last.open();
  expect(await screen.findByRole('link', { name: /show the verdict/i })).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(2);
});
