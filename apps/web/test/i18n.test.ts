import { expect, test } from 'vitest';
import { format, t } from '../src/i18n/t';

test('returns copy for a key', () => {
  expect(t('feed.title').length).toBeGreaterThan(0);
});

test('interpolates params', () => {
  expect(format('{count} Turns by {name}', { count: 3, name: 'Fake A' })).toBe('3 Turns by Fake A');
});

test('leaves unknown placeholders visible', () => {
  expect(format('Hello {missing}', {})).toBe('Hello {missing}');
});
