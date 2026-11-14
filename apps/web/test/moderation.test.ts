import { expect, test } from 'vitest';
import { reportCounts, reportReasons, waitingSince } from '../src/lib/moderation';

test('names only the kinds of Report there are, singular or plural', () => {
  expect(reportCounts(0, 1)).toBe('1 anonymous Report');
  expect(reportCounts(1, 0)).toBe('1 Member Report');
  expect(reportCounts(2, 3)).toBe('2 Member Reports and 3 anonymous Reports');
  expect(reportCounts(0, 0)).toBe('');
});

test('lists each Report reason once, in order', () => {
  expect(reportReasons([{ reason: 'harassment' }, { reason: 'hate' }, { reason: 'harassment' }])).toBe('Harassment or bullying, Hate');
  expect(reportReasons([])).toBe('');
});

test('says how long a Debate has been waiting', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  expect(waitingSince('2026-11-14T12:00:30Z', now)).toBe('now');
  expect(waitingSince('2026-11-14T11:58:00Z', now)).toBe('2 minutes ago');
  expect(waitingSince('2026-11-14T07:00:00Z', now)).toBe('5 hours ago');
  expect(waitingSince('2026-11-13T10:00:00Z', now)).toBe('yesterday');
  expect(waitingSince('2026-11-04T12:00:00Z', now)).toBe('10 days ago');
});
