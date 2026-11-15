import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createDraftSender, DRAFT_INTERVAL_MS, MAX_DRAFTS_PER_TURN } from '../src/live/drafts';

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

test('a slow send never builds a backlog: one in flight, then only the latest text', async () => {
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const drafts = createDraftSender(async text => {
    started.push(text);
    await new Promise<void>(resolve => releases.push(resolve));
  });
  drafts.push('a');
  await vi.advanceTimersByTimeAsync(0);
  for (const text of ['ab', 'abc', 'abcd', 'abcde']) {
    drafts.push(text);
    await vi.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
  }
  // The first send is still running: nothing else has started, however long it takes.
  expect(started).toEqual(['a']);
  releases.shift()!();
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(['a', 'abcde']);
  releases.shift()!();
  await expect(drafts.stop()).resolves.toBeUndefined();
  expect(started).toEqual(['a', 'abcde']);
});

test('a long Turn backs off and stops at MAX_DRAFTS_PER_TURN, leaving room for the Turn itself', async () => {
  // Each draft is a call to the room, which counts against the consumer run's subrequest limit (50 on the
  // Free plan): the Turn event that follows must never be the call that does not fit.
  expect(MAX_DRAFTS_PER_TURN).toBe(40);
  const sentAt: number[] = [];
  const drafts = createDraftSender(async () => void sentAt.push(Date.now()));
  const start = Date.now();
  for (let ms = 0; ms <= 120_000; ms += 50) {
    drafts.push(`text at ${ms}`);
    await vi.advanceTimersByTimeAsync(50);
  }
  await drafts.stop();
  expect(sentAt).toHaveLength(MAX_DRAFTS_PER_TURN);
  const gaps = sentAt.slice(1).map((t, i) => t - sentAt[i]!);
  // 300 ms between the first ten, then twice as long after every ten.
  expect(gaps.slice(0, 9).every(g => g >= 300 && g < 600)).toBe(true);
  expect(gaps.slice(10, 19).every(g => g >= 600)).toBe(true);
  expect(gaps.slice(30).every(g => g >= 2400)).toBe(true);
  // Forty drafts cover more than 40 s of writing before the seat freezes until the Turn.
  expect(sentAt.at(-1)! - start).toBeGreaterThan(40_000);
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
