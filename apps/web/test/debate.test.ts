import { expect, test } from 'vitest';
import { groupByPhase, modelLabel, nextFeedCursor, paragraphs, sideLabel, swingText, turnHeading } from '../src/lib/debate';

const format = { phases: [{ name: 'Opening' }, { name: 'Rebuttal' }] };
const turn = (phaseIndex: number, side: 'for' | 'against') => ({ phaseIndex, side, text: 'x', truncated: false });

test('paragraphs splits on blank lines and drops empties', () => {
  expect(paragraphs('One\nstill one\n\n\n  Two  \n\n')).toEqual(['One\nstill one', 'Two']);
  expect(paragraphs('   ')).toEqual([]);
});

test('turnHeading names the Phase and Side', () => {
  expect(turnHeading(format, turn(1, 'against'))).toBe('Rebuttal · Against');
});

test('groupByPhase keeps Format order and skips empty Phases', () => {
  const groups = groupByPhase(format, [turn(0, 'for'), turn(0, 'against'), turn(1, 'against')]);
  expect(groups.map(g => [g.name, g.turns.length])).toEqual([
    ['Opening', 2],
    ['Rebuttal', 1],
  ]);
  expect(groupByPhase(format, [turn(0, 'for')]).map(g => g.name)).toEqual(['Opening']);
});

test('swingText explains the Audience Result', () => {
  expect(swingText({ counted: 0, swing: { for: 0, against: 0 }, winner: 'tie' })).toBe('No Audience Votes counted yet.');
  expect(swingText({ counted: 4, swing: { for: 25, against: -12.5 }, winner: 'for' })).toBe(
    'For swung +25 points, Against −12.5 points across 4 Members: For wins the audience.',
  );
  expect(swingText({ counted: 1, swing: { for: 0, against: 0 }, winner: 'tie' })).toBe(
    'For swung 0 points, Against 0 points across 1 Member: the Swing is tied.',
  );
});

test('swingText counts AI Voters for the AI Audience Result', () => {
  expect(swingText({ counted: 9, swing: { for: -10, against: 30 }, winner: 'against' }, 'aiVoters')).toBe(
    'For swung −10 points, Against +30 points across 9 AI Voters: Against wins the audience.',
  );
});

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
