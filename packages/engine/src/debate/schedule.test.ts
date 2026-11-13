import { expect, test } from 'vitest';
import { CLASSIC_FORMAT } from '../formats/classic';
import { sixTurns } from '../testing/fixtures';
import { nextSlot, turnSlots } from './schedule';

test('Classic has six slots, For first in each Phase', () => {
  expect(turnSlots(CLASSIC_FORMAT)).toEqual([
    { phaseIndex: 0, side: 'for' }, { phaseIndex: 0, side: 'against' },
    { phaseIndex: 1, side: 'for' }, { phaseIndex: 1, side: 'against' },
    { phaseIndex: 2, side: 'for' }, { phaseIndex: 2, side: 'against' },
  ]);
});

test('nextSlot follows the existing Turns', () => {
  expect(nextSlot(CLASSIC_FORMAT, sixTurns.slice(0, 3))).toEqual({ phaseIndex: 1, side: 'against' });
});

test('nextSlot returns null when all Turns exist', () => {
  expect(nextSlot(CLASSIC_FORMAT, sixTurns)).toBeNull();
});
