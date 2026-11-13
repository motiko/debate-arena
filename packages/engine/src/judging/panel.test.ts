import { expect, test } from 'vitest';
import type { Debater } from '../domain';
import { InvalidPanelError } from '../errors';
import { isSelfJudging, modelFamily, suggestPanel, validatePanel } from './panel';

const ai = (model: string): Debater => ({ kind: 'ai', model });

test('model family is the provider prefix', () => {
  expect(modelFamily('anthropic/claude-sonnet-5-5')).toBe('anthropic');
});

test('suggests a Judge from another family', () => {
  expect(suggestPanel([ai('anthropic/a'), ai('openai/b')], ['anthropic/j', 'openai/j', 'google/j'])).toEqual(['google/j']);
});

test('falls back to a different model of the same family', () => {
  expect(suggestPanel([ai('anthropic/a')], ['anthropic/a', 'anthropic/j'])).toEqual(['anthropic/j']);
});

test('falls back to the first candidate when nothing else fits', () => {
  expect(suggestPanel([ai('anthropic/a')], ['anthropic/a'])).toEqual(['anthropic/a']);
});

test('an empty candidate list is an error', () => {
  expect(() => suggestPanel([ai('anthropic/a')], [])).toThrow(InvalidPanelError);
});

test('detects Self-Judging by exact model id', () => {
  expect(isSelfJudging(['anthropic/a'], [ai('anthropic/a'), ai('openai/b')])).toBe(true);
  expect(isSelfJudging(['anthropic/j'], [ai('anthropic/a'), ai('openai/b')])).toBe(false);
});

test('Panels hold exactly one Judge in this release', () => {
  expect(() => validatePanel([])).toThrow(InvalidPanelError);
  expect(() => validatePanel(['x/1', 'y/2'])).toThrow(InvalidPanelError);
  expect(() => validatePanel(['x/1'])).not.toThrow();
});
