import type { PublicDebate } from '@debate-arena/api-client';
import { expect, test } from 'vitest';
import { renderDebate, renderTurn, renderVerdict, turnHeader } from './render.ts';
import { BASE, debate } from './testing.ts';

test('a Turn header names the phase, Side and model', () => {
  expect(turnHeader(debate(), { phaseIndex: 1, side: 'against' })).toBe('── Rebuttal · Against · b/two ──');
});

test('a Turn is its header and text, and says when it was cut at the word limit', () => {
  expect(renderTurn(debate(), { phaseIndex: 0, side: 'for', text: 'Yes.', truncated: false })).toBe('── Opening · For · a/one ──\nYes.\n');
  expect(renderTurn(debate(), { phaseIndex: 0, side: 'for', text: 'Yes', truncated: true })).toContain('(cut at the word limit)');
});

test('a completed Debate shows its Motion, Turns, Verdict and vote link', () => {
  const text = renderDebate(debate(), BASE);
  expect(text).toContain('Pineapple belongs on pizza');
  expect(text).toContain('For: a/one · Against: b/two');
  expect(text).toContain('── Opening · Against · b/two ──\nFruit has no place here.');
  expect(text).toContain('Verdict: For wins (c/three)\nBetter evidence.');
  expect(text.trimEnd().endsWith(`Read and vote: ${BASE}/debates/d1`)).toBe(true);
});

const verdict = { winner: 'against' as const, reasoning: 'Held the burden.', judges: ['c/three'], scores: [], confidence: null, crux: '', claims: [], ballots: [] };

test('renderVerdict lists each Rubric Score between the winner and the reasoning', () => {
  const scores = [{ criterion: 'Argument strength', for: 7, against: 6 }, { criterion: 'Clarity', for: 8, against: 9 }];
  expect(renderVerdict({ ...verdict, scores })).toBe(
    'Verdict: Against wins (c/three)\n  Argument strength: For 7 · Against 6\n  Clarity: For 8 · Against 9\nHeld the burden.\n',
  );
});

test('renderVerdict with no scores is unchanged, even from a server that sends none', () => {
  const plain = 'Verdict: Against wins (c/three)\nHeld the burden.\n';
  expect(renderVerdict({ ...verdict, scores: [] })).toBe(plain);
  const { scores: _, confidence: __, crux: ___, claims: ____, ballots: _____, ...fromOldServer } = verdict;
  expect(renderVerdict(fromOldServer as unknown as Parameters<typeof renderVerdict>[0])).toBe(plain);
});

test('renderVerdict on the Motion: stands or falls, confidence, Panel split, crux and checked claims', () => {
  const ballot = (judge: string, winner: 'for' | 'against') => ({ judge, winner, confidence: 'likely' as const, reasoning: 'r', crux: '', scores: [], claims: [] });
  const claims = [{ side: 'for' as const, claim: 'Denmark cut it to 2.6%', status: 'false' as const, note: 'It was 2.6% in 2022 only.' }];
  const onMotion = {
    ...verdict,
    winner: 'for' as const,
    judges: ['a/j', 'b/j', 'c/j'],
    confidence: 'clear' as const,
    crux: 'Whether tightening works.',
    claims,
    ballots: [ballot('a/j', 'for'), ballot('b/j', 'against'), ballot('c/j', 'for')],
  };
  expect(renderVerdict(onMotion)).toBe(
    'Verdict: the Motion stands (For), clear · Panel 2–1 (a/j, b/j, c/j)\nCrux: Whether tightening works.\nHeld the burden.\n  [false] For: Denmark cut it to 2.6% — It was 2.6% in 2022 only.\n',
  );
  expect(renderVerdict({ ...onMotion, winner: 'against', confidence: 'narrow', ballots: [], claims: [], crux: '', judges: ['a/j'] })).toBe(
    'Verdict: the Motion falls (Against), too close to call (a/j)\nHeld the burden.\n',
  );
});

test('a running Debate says so and has no Verdict yet', () => {
  const text = renderDebate(debate({ status: 'running', verdict: null }), BASE);
  expect(text).toContain('Running');
  expect(text).not.toContain('Verdict:');
});

test('a failed Debate says so', () => {
  expect(renderDebate(debate({ status: 'failed', verdict: null }), BASE)).toContain('Failed');
});

test('the AI Audience Result is shown when there is one', () => {
  const aiAudience = { counted: 10, swing: { for: 20, against: -20 }, winner: 'for' as const, dropped: [], votes: [] };
  expect(renderDebate(debate({ aiAudience }), BASE)).toContain('AI Audience: For wins (swing For +20, Against -20)');
});

test("renderAiAudience lists each AI Voter's model and votes", () => {
  const votes = [{ model: 'a/x', before: 'undecided' as const, after: 'for' as const }];
  const aiAudience = { counted: 1, swing: { for: 100, against: 0 }, winner: 'for' as const, dropped: [], votes };
  expect(renderDebate(debate({ aiAudience }), BASE)).toContain('  a/x: Undecided → For\n');
});

test('a Custom Debater shows its nickname and self-reported model, if any', () => {
  const header = (forSeat: PublicDebate['debaters']['for']) =>
    turnHeader(debate({ debaters: { for: forSeat, against: { kind: 'ai', model: 'b/two' } } }), { phaseIndex: 0, side: 'for' });
  expect(header({ kind: 'api' })).toBe('── Opening · For · Custom Debater ──');
  expect(header({ kind: 'api', name: 'Atlas', model: 'gpt-6' })).toBe('── Opening · For · Atlas (Custom, self-reported model: gpt-6) ──');
  expect(header({ kind: 'api', model: 'gpt-6' })).toBe('── Opening · For · Custom Debater (self-reported model: gpt-6) ──');
});
