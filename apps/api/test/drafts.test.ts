import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createDraftSender, DRAFT_INTERVAL_MS } from '../src/live/drafts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function recorder() {
  const sent: string[] = [];
  return { sent, send: async (text: string) => void sent.push(text) };
}

test('sends the first draft at once, then the latest text at most every 300 ms', async () => {
  expect(DRAFT_INTERVAL_MS).toBe(300);
  const { sent, send } = recorder();
  const drafts = createDraftSender(send);
  drafts.push('a');
  await vi.advanceTimersByTimeAsync(0);
  drafts.push('ab');
  await vi.advanceTimersByTimeAsync(50);
  drafts.push('abc');
  await vi.advanceTimersByTimeAsync(100);
  expect(sent).toEqual(['a']);
  await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
  expect(sent).toEqual(['a', 'abc']);
  await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS * 3);
  expect(sent).toEqual(['a', 'abc']);
});

test('stop() drops a pending draft and waits for one in flight', async () => {
  let release!: () => void;
  const sent: string[] = [];
  const drafts = createDraftSender(async text => {
    sent.push(`start ${text}`);
    await new Promise<void>(resolve => (release = resolve));
    sent.push(`end ${text}`);
  });
  drafts.push('a');
  await vi.advanceTimersByTimeAsync(0);
  drafts.push('ab');
  const stopped = drafts.stop();
  let done = false;
  void stopped.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toBe(false);
  release();
  await stopped;
  await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS * 2);
  expect(sent).toEqual(['start a', 'end a']);
  drafts.push('abc');
  await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS * 2);
  expect(sent).toEqual(['start a', 'end a']);
});

test('a failing send is swallowed', async () => {
  const drafts = createDraftSender(async () => {
    throw new Error('room down');
  });
  drafts.push('a');
  await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
  drafts.push('ab');
  await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
  await expect(drafts.stop()).resolves.toBeUndefined();
});
