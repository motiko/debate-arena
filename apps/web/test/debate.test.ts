import { describe, expect, test } from 'vitest';
import {
  debaterLabel,
  dispatchState,
  feedOutcome,
  groupByPhase,
  outcomeHidden,
  motionSize,
  outcome,
  spokeCount,
  swingBars,
  modelLabel,
  nextFeedCursor,
  paragraphs,
  selfJudgingWarning,
  sideLabel,
  swingText,
  turnHeading,
} from '../src/lib/debate';

test('selfJudgingWarning flags a Judge that is a Debater', () => {
  expect(selfJudgingWarning({ for: 'a/x', against: 'b/y' }, 'a/x')).toBe(true);
  expect(selfJudgingWarning({ for: 'a/x', against: 'b/y' }, 'b/y')).toBe(true);
  expect(selfJudgingWarning({ for: 'a/x', against: 'b/y' }, 'c/z')).toBe(false);
  expect(selfJudgingWarning({ for: 'a/x', against: 'b/y' }, null)).toBe(false);
});

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

describe('chamber helpers', () => {
  const models = [
    { id: 'fake-a/one', label: 'Fake A' },
    { id: 'fake-b/one', label: 'Fake B' },
  ];
  const debaters = { for: { kind: 'ai' as const, model: 'fake-a/one' }, against: { kind: 'ai' as const, model: 'fake-b/one' } };
  const result = (winner: 'for' | 'against' | 'tie', counted = 4, swingFor = 13) => ({ counted, swing: { for: swingFor, against: -swingFor }, winner });
  const NOW = Date.parse('2026-11-14T12:00:00Z');
  const open = { votingClosesAt: '2026-11-21T12:00:00Z' };
  const closed = { votingClosesAt: '2026-11-10T12:00:00Z' };
  const base = { kind: 'live' as const, status: 'complete' as const, turnsHidden: false, turns: [1, 2], myVote: null, audienceResult: open };

  test('motionSize steps down with length', () => {
    expect(motionSize('x'.repeat(120))).toBe('l');
    expect(motionSize('x'.repeat(121))).toBe('m');
    expect(motionSize('x'.repeat(200))).toBe('m');
    expect(motionSize('x'.repeat(201))).toBe('s');
  });

  test('dispatchState follows the spec table in order', () => {
    expect(dispatchState({ ...base, status: 'running', turnsHidden: true }, NOW)).toBe('ask');
    expect(dispatchState({ ...base, kind: 'batch', status: 'running' }, NOW)).toBe('generating');
    expect(dispatchState({ ...base, status: 'running' }, NOW)).toBe('live');
    expect(dispatchState({ ...base, status: 'failed' }, NOW)).toBe('judgingFailed');
    expect(dispatchState({ ...base, status: 'failed', turns: [] }, NOW)).toBe('failed');
    expect(dispatchState({ ...base, myVote: { before: 'for', after: null } }, NOW)).toBe('askAfter');
    expect(dispatchState(base, NOW)).toBe('hidden');
    expect(dispatchState({ ...base, myVote: { before: 'for', after: 'for' } }, NOW)).toBe('revealed');
    expect(dispatchState({ ...base, audienceResult: closed }, NOW)).toBe('revealed');
    expect(dispatchState({ ...base, myVote: { before: 'for', after: null }, audienceResult: closed }, NOW)).toBe('revealed');
  });

  test('a Batch Debate takes no Audience Votes, so its outcome is open', () => {
    expect(dispatchState({ ...base, kind: 'batch' }, NOW)).toBe('revealed');
  });

  test('outcomeHidden: hidden while voting is open and the reader has no after-vote (spec: the hybrid rule)', () => {
    const live = { kind: 'live' as const, status: 'complete' as const, votingClosesAt: open.votingClosesAt };
    expect(outcomeHidden(live, NOW)).toBe(true);
    expect(outcomeHidden({ ...live, myVote: { before: 'for', after: null } }, NOW)).toBe(true);
    expect(outcomeHidden({ ...live, myVote: { before: 'for', after: 'against' } }, NOW)).toBe(false);
    expect(outcomeHidden({ ...live, votingClosesAt: closed.votingClosesAt }, NOW)).toBe(false);
    // The window closes at the instant itself.
    expect(outcomeHidden({ ...live, votingClosesAt: new Date(NOW).toISOString() }, NOW)).toBe(false);
    expect(outcomeHidden({ ...live, kind: 'batch' }, NOW)).toBe(false);
    expect(outcomeHidden({ ...live, status: 'failed', votingClosesAt: null }, NOW)).toBe(false);
    // Still running: before-votes are open and nothing is decided yet.
    expect(outcomeHidden({ ...live, status: 'running', votingClosesAt: null }, NOW)).toBe(true);
    // An older API without the closing time: shown, never hidden for good.
    expect(outcomeHidden({ ...live, votingClosesAt: undefined }, NOW)).toBe(false);
  });

  test('feedOutcome says "Voting open" instead of the outcome while the vote runs', () => {
    const entry = { kind: 'live' as const, status: 'complete' as const, verdict: { winner: 'for' as const }, votingClosesAt: open.votingClosesAt };
    expect(feedOutcome(entry, NOW)).toBe('votingOpen');
    expect(feedOutcome({ ...entry, votingClosesAt: closed.votingClosesAt }, NOW)).toBe('carried');
    expect(feedOutcome({ ...entry, verdict: { winner: 'against' }, votingClosesAt: closed.votingClosesAt }, NOW)).toBe('defeated');
    expect(feedOutcome({ ...entry, kind: 'batch' }, NOW)).toBe('carried');
    expect(feedOutcome({ ...entry, verdict: null }, NOW)).toBeNull();
  });

  test('a failed Batch Debate is failed, not generating', () => {
    expect(dispatchState({ ...base, kind: 'batch', status: 'failed', turns: [] }, NOW)).toBe('failed');
  });

  test('outcome names the winning model when judge and audience agree', () => {
    expect(outcome({ kind: 'live', debaters, verdict: { winner: 'for' }, audienceResult: result('for') }, models)).toEqual({
      headline: 'Fake A carries the Motion',
      judge: 'Judge: For',
      audience: 'Audience: For, +13 points',
      split: false,
    });
    expect(outcome({ kind: 'live', debaters, verdict: { winner: 'against' }, audienceResult: result('tie', 4, 0) }, models)).toMatchObject({
      headline: 'Fake B defeats the Motion',
      audience: 'Audience: tied',
      split: false,
    });
  });

  test('outcome calls a disagreement a split decision', () => {
    expect(outcome({ kind: 'live', debaters, verdict: { winner: 'against' }, audienceResult: result('for') }, models)).toMatchObject({
      headline: 'Split decision',
      split: true,
    });
  });

  test('outcome without paired votes, for batch, and without a Verdict', () => {
    expect(outcome({ kind: 'live', debaters, verdict: { winner: 'for' }, audienceResult: result('for', 0, 0) }, models)).toMatchObject({
      audience: 'Audience: no paired votes yet',
      split: false,
    });
    expect(outcome({ kind: 'batch', debaters, verdict: { winner: 'for' }, audienceResult: result('against') }, models)).toMatchObject({
      audience: null,
      split: false,
    });
    expect(outcome({ kind: 'live', debaters, verdict: null, audienceResult: result('for') }, models)).toBeNull();
  });

  test('spokeCount counts one Side', () => {
    const turns = [{ side: 'for' as const }, { side: 'against' as const }, { side: 'for' as const }];
    expect(spokeCount(turns, 'for')).toBe(2);
    expect(spokeCount(turns, 'against')).toBe(1);
  });

  test('swingBars sizes each Side on its half of the axis', () => {
    expect(swingBars(result('for', 4, 13))).toEqual({ for: { points: 13, width: '6.5%' }, against: { points: -13, width: '6.5%' } });
    expect(swingBars(result('tie', 4, 0))).toEqual({ for: { points: 0, width: '0%' }, against: { points: 0, width: '0%' } });
    expect(swingBars(result('for', 4, 140)).for.width).toBe('50%');
    expect(swingBars({ swing: { for: 12.34, against: -12.34 } }).for.points).toBe(12.3);
  });

  test('debaterLabel uses the model label', () => {
    expect(debaterLabel(debaters.for, models)).toBe('Fake A');
  });
});
