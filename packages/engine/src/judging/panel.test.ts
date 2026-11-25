import { expect, test } from 'vitest';
import type { Debater } from '../domain';
import { InvalidPanelError } from '../errors';
import { isSelfJudging, modelFamily, suggestPanel, validatePanel } from './panel';

const ai = (model: string): Debater => ({ kind: 'ai', model });

test('model family is the provider prefix', () => {
  expect(modelFamily('anthropic/claude-sonnet-5-5')).toBe('anthropic');
});

test('a Panel takes one Judge by default, a Judge from another family', () => {
  expect(suggestPanel([ai('anthropic/a'), ai('openai/b')], ['anthropic/j', 'openai/j', 'google/j'])).toEqual(['google/j']);
});

test('falls back to a different model of the same family', () => {
  expect(suggestPanel([ai('anthropic/a')], ['anthropic/a', 'anthropic/j'])).toEqual(['anthropic/j']);
});

test('falls back to the first candidate when nothing else fits', () => {
  expect(suggestPanel([ai('anthropic/a')], ['anthropic/a'])).toEqual(['anthropic/a']);
});

test('suggests three Judges from three families, preferring families no Debater uses', () => {
  const candidates = ['anthropic/j', 'google/j', 'google/k', 'openai/j', 'mistral/j', 'qwen/j'];
  expect(suggestPanel([ai('anthropic/a'), ai('openai/b')], candidates, 3)).toEqual(['google/j', 'mistral/j', 'qwen/j']);
});

test('fills a three-Judge Panel from Debater families when too few others exist, never with a Debater', () => {
  expect(suggestPanel([ai('anthropic/a'), ai('openai/b')], ['anthropic/a', 'anthropic/j', 'openai/j', 'google/j'], 3)).toEqual(['google/j', 'anthropic/j', 'openai/j']);
});

test('suggests one Judge rather than seat a Debater on a three-Judge Panel', () => {
  expect(suggestPanel([ai('a/1'), ai('b/1')], ['a/1', 'b/1', 'c/1', 'd/1'], 3)).toEqual(['c/1']);
});

test('suggests one Judge when fewer than three candidates exist', () => {
  expect(suggestPanel([ai('anthropic/a')], ['google/j', 'openai/j'], 3)).toEqual(['google/j']);
});

test('a three-Judge Panel of Custom Debaters takes three families', () => {
  expect(suggestPanel([{ kind: 'api' }, { kind: 'api' }], ['a/1', 'a/2', 'b/1', 'c/1'], 3)).toEqual(['a/1', 'b/1', 'c/1']);
});

test('an empty candidate list is an error', () => {
  expect(() => suggestPanel([ai('anthropic/a')], [])).toThrow(InvalidPanelError);
});

test('detects Self-Judging by exact model id', () => {
  expect(isSelfJudging(['anthropic/a'], [ai('anthropic/a'), ai('openai/b')])).toBe(true);
  expect(isSelfJudging(['anthropic/j'], [ai('anthropic/a'), ai('openai/b')])).toBe(false);
});

test('Panels hold one or three distinct Judges', () => {
  for (const panel of [[], ['x/1', 'y/2'], ['x/1', 'y/2', 'z/3', 'w/4'], ['x/1', 'x/1', 'y/2']]) expect(() => validatePanel(panel)).toThrow(InvalidPanelError);
  expect(() => validatePanel(['x/1'])).not.toThrow();
  expect(() => validatePanel(['x/1', 'y/2', 'z/3'])).not.toThrow();
});
