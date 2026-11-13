import { expect, test } from 'vitest';
import { modelLabel, nextFeedCursor, sideLabel } from '../src/lib/debate';

const summary = (completedAt: string) => ({ completedAt }) as unknown as Parameters<typeof nextFeedCursor>[0][number];

test('nextFeedCursor gives the last completedAt only for a full page', () => {
  const page = [summary('2026-11-13T10:00:00.000Z'), summary('2026-11-12T10:00:00.000Z')];
  expect(nextFeedCursor(page, 2)).toBe('2026-11-12T10:00:00.000Z');
  expect(nextFeedCursor(page, 3)).toBeNull();
  expect(nextFeedCursor([], 20)).toBeNull();
});

test('sideLabel names Sides in GLOSSARY words', () => {
  expect(sideLabel('for')).toBe('For');
  expect(sideLabel('against')).toBe('Against');
});

test('modelLabel prefers the catalog label and falls back to the id', () => {
  const models = [{ id: 'fake-a/one', label: 'Fake A' }];
  expect(modelLabel('fake-a/one', models)).toBe('Fake A');
  expect(modelLabel('gone/model', models)).toBe('gone/model');
});
