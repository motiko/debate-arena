import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { connectLive, liveUrl } from './index.ts';
import { FakeSocket } from './testing/fake-socket.ts';

beforeEach(() => FakeSocket.reset());
afterEach(() => vi.useRealTimers());

const impl = FakeSocket as unknown as typeof WebSocket;

test('liveUrl uses ws: or wss: on the base URL host', () => {
  expect(liveUrl('https://x.test', 'a b')).toBe('wss://x.test/api/debates/a%20b/live');
  expect(liveUrl('http://localhost:4321', 'd')).toBe('ws://localhost:4321/api/debates/d/live');
  expect(liveUrl('https://x.test/some/path/', 'd')).toBe('wss://x.test/api/debates/d/live');
});

test('passes Debate events on and ignores pongs', () => {
  const events: unknown[] = [];
  const statuses: string[] = [];
  connectLive('ws://x/live', { onEvent: e => events.push(e), onStatus: s => statuses.push(s) }, { WebSocketImpl: impl });
  FakeSocket.last.open();
  FakeSocket.last.emit({ type: 'pong' });
  FakeSocket.last.emit({ type: 'verdict', verdict: { winner: 'for', reasoning: 'r', judges: [] } });
  expect(events).toEqual([{ type: 'verdict', verdict: { winner: 'for', reasoning: 'r', judges: [] } }]);
  expect(statuses).toEqual(['connecting', 'open']);
});

test('reconnects after an unexpected close, until closed on purpose', () => {
  vi.useFakeTimers();
  const statuses: string[] = [];
  const live = connectLive('ws://x/live', { onEvent: () => {}, onStatus: s => statuses.push(s) }, { WebSocketImpl: impl, retryMs: 2000 });
  FakeSocket.last.open();
  FakeSocket.last.drop();
  expect(statuses.at(-1)).toBe('reconnecting');
  expect(FakeSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(2000);
  expect(FakeSocket.instances).toHaveLength(2);
  live.close();
  expect(statuses.at(-1)).toBe('closed');
  vi.advanceTimersByTime(10_000);
  expect(FakeSocket.instances).toHaveLength(2);
});

test('gives up after the retry limit', () => {
  vi.useFakeTimers();
  const statuses: string[] = [];
  connectLive('ws://x/live', { onEvent: () => {}, onStatus: s => statuses.push(s) }, { WebSocketImpl: impl, retryMs: 10, maxRetries: 2 });
  for (let i = 0; i < 3; i++) {
    FakeSocket.last.drop();
    vi.advanceTimersByTime(10);
  }
  expect(FakeSocket.instances).toHaveLength(3);
  expect(statuses.at(-1)).toBe('closed');
});

test('keeps the connection alive with pings', () => {
  vi.useFakeTimers();
  connectLive('ws://x/live', { onEvent: () => {}, onStatus: () => {} }, { WebSocketImpl: impl, pingMs: 1000 });
  FakeSocket.last.open();
  vi.advanceTimersByTime(2500);
  expect(FakeSocket.last.sent).toEqual(['ping', 'ping']);
});
