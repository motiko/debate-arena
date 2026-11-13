import { expect, test } from 'vitest';
import { CLASSIC_FORMAT } from './classic';

test('Classic Format matches the spec', () => {
  expect(CLASSIC_FORMAT.id).toBe('classic');
  expect(CLASSIC_FORMAT.phases.map(p => [p.name, p.order, p.maxWords, p.maxSeconds])).toEqual([
    ['Opening', ['for', 'against'], 300, 120],
    ['Rebuttal', ['for', 'against'], 200, 80],
    ['Closing', ['for', 'against'], 150, 60],
  ]);
  expect(CLASSIC_FORMAT.rubric.criteria.map(c => c.name))
    .toEqual(['Argument strength', 'Rebuttal quality', 'Evidence', 'Clarity']);
  expect(CLASSIC_FORMAT.votingMethod).toEqual({ kind: 'oxford', windowDays: 7 });
});
