import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';
import LiveTurns from '../src/islands/LiveTurns.svelte';
import { mergeTurns } from '../src/lib/debate';
import { FakeSocket } from '@debate-arena/api-client/testing';

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

const apiSpeakers = { for: 'API Debater', against: 'Fake B' };

test('while the Debate waits for an API Turn, the seat says so; a draft turns it into speaking', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers: apiSpeakers, apiSides: ['for'], initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl, smooth: false });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'awaiting', slotIndex: 0, deadline: '2026-11-15T12:10:00.000Z' });
  await vi.waitFor(() => expect(screen.getByText('For is preparing a Turn via the API')).toBeInTheDocument());
  FakeSocket.last.emit({ type: 'draft', slotIndex: 0, text: 'Half a' });
  await vi.waitFor(() => expect(screen.getByText('For is speaking')).toBeInTheDocument());
  expect(screen.queryByText('For is preparing a Turn via the API')).toBeNull();
});

test('a page opened while the Debate waits shows the wait at once', () => {
  render(LiveTurns, { debateId: 'd1', format, speakers: apiSpeakers, apiSides: ['for'], initialTurns: [], initialAwaiting: 0, fetcher: debateFetcher([]), WebSocketImpl: impl });
  expect(screen.getByText('For is preparing a Turn via the API')).toBeInTheDocument();
});

test('a stale awaiting event for a slot already written is ignored', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers: apiSpeakers, apiSides: ['for'], initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'awaiting', slotIndex: 0, deadline: '2026-11-15T12:10:00.000Z' });
  await new Promise(r => setTimeout(r, 0));
  expect(screen.queryByText(/preparing a Turn via the API/)).toBeNull();
  expect(screen.getByText('Against speaks next')).toBeInTheDocument();
});

test("the API side's Turns are labelled as submitted via API", () => {
  render(LiveTurns, { debateId: 'd1', format, speakers: apiSpeakers, apiSides: ['for'], initialTurns: [turn(0), turn(1)], fetcher: debateFetcher([turn(0), turn(1)]), WebSocketImpl: impl });
  const [first, second] = screen.getAllByRole('article');
  expect(first).toHaveTextContent('Submitted via API');
  expect(second).toHaveTextContent('AI-generated');
});

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

test('at the end, brings the outcome into the page without reloading', async () => {
  const refresh = vi.fn(async () => true);
  const reload = vi.fn();
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl, refresh, reload });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.getByRole('status')).toHaveTextContent('The Debate is over.');
  expect(screen.queryByText(/^Live/)).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  expect(reload).not.toHaveBeenCalled();
});

test('offers a reload when the outcome cannot be brought in', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl, refresh: async () => false });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  expect(await screen.findByRole('link', { name: 'Reload to see the result' })).toHaveAttribute('href', '/debates/d1');
});

test('the Verdict alone does not end the Debate: voting opens only once it is complete', async () => {
  const refresh = vi.fn(async () => true);
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [0, 1, 2, 3].map(turn), fetcher: debateFetcher([0, 1, 2, 3].map(turn)), WebSocketImpl: impl, refresh });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'verdict', verdict: { winner: 'for', reasoning: 'x', judges: ['j'] } });
  expect(await screen.findByText('The speeches are over. The Judge is reaching a Verdict.')).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
  FakeSocket.last.emit({ type: 'complete', aiAudience: null });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
});

test('says so when the Debate fails', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'failed', reason: 'The Debate could not be completed.' });
  expect(await screen.findByText('This Debate could not be completed.')).toBeInTheDocument();
});

test('shows a draft as it is written, then replaces it with the finished Turn', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 1, text: 'Madam' });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')).toHaveTextContent('Madam'));
  FakeSocket.last.emit({ type: 'draft', slotIndex: 1, text: 'Madam Chair' });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')).toHaveTextContent('Madam Chair'));
  expect(screen.getByText('Against is speaking')).toBeInTheDocument();
  FakeSocket.last.emit({ type: 'turn', slotIndex: 1, turn: turn(1) });
  await vi.waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(document.querySelector('.speech-draft')).toBeNull();
});

test('a finished Turn is written out to its end in the seat, then takes its place on the floor', async () => {
  const long = { ...turn(1), text: `Madam Chair, ${'and so on, '.repeat(40)}the end.` };
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 1, text: 'Madam Chair' });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')).toHaveTextContent('Madam Chair'));
  FakeSocket.last.emit({ type: 'turn', slotIndex: 1, turn: long });
  // Not swapped in at once: the rest is still being written, and the live region has not announced it yet.
  await new Promise(r => setTimeout(r, 50));
  const seat = document.querySelector('.speech-draft')!;
  expect(seat).not.toBeNull();
  expect(seat.textContent!.length).toBeLessThan(long.text.length);
  expect(screen.getAllByRole('article')).toHaveLength(1);
  await vi.waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2), { timeout: 3000 });
  expect(document.querySelector('.speech-draft')).toBeNull();
});

test('with reduced motion, a draft shows as it arrives', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl, smooth: false });
  FakeSocket.last.open();
  const text = `Madam Chair, ${'and so on, '.repeat(40)}`;
  FakeSocket.last.emit({ type: 'draft', slotIndex: 1, text });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')?.textContent).toContain(text.trim()));
  FakeSocket.last.emit({ type: 'turn', slotIndex: 1, turn: turn(1) });
  await vi.waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
});

test('a draft for a Turn that catch-up already loaded is dropped', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const fetcher = vi.fn(async () => {
    await gate;
    return Response.json({ status: 'running', turns: [turn(0), turn(1)] });
  }) as unknown as typeof fetch;
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher, WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 1, text: 'Madam Chair' });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')).not.toBeNull());
  release();
  await vi.waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(document.querySelector('.speech-draft')).toBeNull();
});

test('a Block clears the draft with the Turns', async () => {
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [turn(0)], fetcher: debateFetcher([turn(0)]), WebSocketImpl: impl, reload: vi.fn() });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'draft', slotIndex: 1, text: 'Madam Chair' });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')).not.toBeNull());
  FakeSocket.last.emit({ type: 'blocked' });
  await vi.waitFor(() => expect(document.querySelector('.speech-draft')).toBeNull());
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
  const refresh = vi.fn(async () => true);
  render(LiveTurns, { debateId: 'd1', format, speakers, initialTurns: [], fetcher: debateFetcher([turn(0), turn(1)], 'complete'), WebSocketImpl: impl, refresh });
  FakeSocket.last.open();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.getByText('The Debate is over.')).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(2);
});
