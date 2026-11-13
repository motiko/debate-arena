import { expect, test } from 'vitest';
import type { Stance } from '../domain';
import { DuplicateVoterError } from '../errors';
import { computeOxfordResult, type VoterStances } from './oxford';

function voters(before: Stance[], after: Stance[]): VoterStances[] {
  return before.map((b, i) => ({ voterId: `v${i}`, before: b, after: after[i]! }));
}

// 10 paired voters: before 4 for / 4 against / 2 undecided; after 6 / 3 / 1
const tenPairedVoters = voters(
  ['for', 'for', 'for', 'for', 'against', 'against', 'against', 'against', 'undecided', 'undecided'],
  ['for', 'for', 'for', 'for', 'for', 'against', 'against', 'against', 'for', 'undecided'],
);

test('the Side that moved more voters wins', () => {
  const r = computeOxfordResult(tenPairedVoters);
  expect(r.counted).toBe(10);
  expect(r.swing.for).toBeCloseTo(20);
  expect(r.swing.against).toBeCloseTo(-10);
  expect(r.winner).toBe('for');
});

test('unpaired votes are ignored', () => {
  const r = computeOxfordResult([
    { voterId: 'a', before: 'for' },
    { voterId: 'b', after: 'against' },
    { voterId: 'c', before: 'against', after: 'for' },
  ]);
  expect(r.counted).toBe(1);
  expect(r.winner).toBe('for');
});

test('equal Swings are a tie', () => {
  expect(computeOxfordResult(voters(['for', 'against'], ['for', 'against'])).winner).toBe('tie');
});

test('no paired voters is a tie', () => {
  expect(computeOxfordResult([])).toEqual({ counted: 0, swing: { for: 0, against: 0 }, winner: 'tie' });
});

test('duplicate voters are rejected', () => {
  expect(() => computeOxfordResult([
    { voterId: 'a', before: 'for', after: 'for' },
    { voterId: 'a', before: 'for', after: 'for' },
  ])).toThrow(DuplicateVoterError);
});
