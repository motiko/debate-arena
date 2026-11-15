import { expect, test } from 'vitest';
import { format, t, tn } from '../src/i18n/t';

test('returns copy for a key', () => {
  expect(t('feed.title').length).toBeGreaterThan(0);
});

test('interpolates params', () => {
  expect(format('{count} Turns by {name}', { count: 3, name: 'Fake A' })).toBe('3 Turns by Fake A');
});

test('leaves unknown placeholders visible', () => {
  expect(format('Hello {missing}', {})).toBe('Hello {missing}');
});

test('picks the plural form by count', () => {
  expect(tn('moderation.memberReports', 1)).toBe('1 Member Report');
  expect(tn('moderation.memberReports', 0)).toBe('0 Member Reports');
  expect(tn('moderation.memberReports', 2)).toBe('2 Member Reports');
  expect(tn('moderation.anonymousReports', 1)).toBe('1 anonymous Report');
  expect(tn('header.quota', 1)).toBe('1 Quota point left today');
  expect(tn('header.quota', 0)).toBe('0 Quota points left today');
  expect(tn('account.quota', 1)).toBe('You have 1 Quota point left today. What a Debate costs depends on its models; you see it before you start.');
});
