import { expect, test } from 'vitest';
import { DebateNotFinishedError, InvalidPanelError, VerdictParseError } from '../errors';
import { FakeModelClient } from '../models/fake';
import { setup, sixTurns } from '../testing/fixtures';
import { buildJudgeMessages, judgeDebate, parseVerdict, SCORES_REQUEST } from './judge';

test('Judge prompt lists the Rubric, demands JSON and forbids a draw', () => {
  const [system] = buildJudgeMessages(setup, sixTurns);
  for (const s of ['Argument strength', 'Rebuttal quality', 'Evidence', 'Clarity', '"winner"', 'must choose'])
    expect(system?.content).toContain(s);
});

test('Judge sees the Motion and every Turn', () => {
  const all = buildJudgeMessages(setup, sixTurns).map(m => m.content).join('\n');
  expect(all).toContain('Remote work beats office work');
  for (const t of sixTurns) expect(all).toContain(t.text);
});

const rubric = setup.format.rubric;
const NAMES = ['Argument strength', 'Rebuttal quality', 'Evidence', 'Clarity'];
/** A Judge reply with the given scores (For, Against per criterion, in Rubric order unless keys say otherwise). */
const scored = (winner: string, scores: unknown, reasoning = 'r') => JSON.stringify({ scores, winner, reasoning });
const allScores = (f: number, a: number) => Object.fromEntries(NAMES.map(n => [n, { for: f, against: a }]));

test('parses plain and fenced JSON', () => {
  expect(parseVerdict('{"winner":"against","reasoning":"r"}', rubric)).toEqual({ winner: 'against', reasoning: 'r', scores: null });
  expect(parseVerdict('```json\n{"winner":"for","reasoning":"r"}\n```', rubric)).toEqual({ winner: 'for', reasoning: 'r', scores: null });
});

test('Judge prompt asks for a 1-10 score per Rubric criterion and Side', () => {
  const [system] = buildJudgeMessages(setup, sixTurns);
  for (const s of ['"scores"', '1 to 10', ...NAMES]) expect(system?.content).toContain(s);
});

test('parses scores in Rubric order', () => {
  const reversed = Object.fromEntries(NAMES.map((n, i) => [n, { for: i + 1, against: 10 - i }]).reverse());
  expect(parseVerdict(scored('for', reversed), rubric)?.scores).toEqual(NAMES.map((criterion, i) => ({ criterion, for: i + 1, against: 10 - i })));
});

test('bad scores are null, the winner and reasoning still parse', () => {
  const { Clarity: _, ...missing } = allScores(5, 5);
  for (const scores of [allScores(7, '7' as never), allScores(7.5, 6), allScores(0, 6), allScores(11, 6), missing, undefined, [], { ...allScores(5, 5), Evidence: 7 }])
    expect(parseVerdict(scored('for', scores), rubric)).toEqual({ winner: 'for', reasoning: 'r', scores: null });
});

test('extra score keys are ignored', () => {
  const scores = parseVerdict(scored('for', { ...allScores(6, 5), '<script>': { for: 1, against: 1 } }), rubric)?.scores;
  expect(scores?.map(s => s.criterion)).toEqual(NAMES);
});

test('scores may favour the losing Side', () => {
  expect(parseVerdict(scored('against', allScores(9, 3)), rubric)).toMatchObject({ winner: 'against', scores: NAMES.map(criterion => ({ criterion, for: 9, against: 3 })) });
});

test('retries when the scores are bad, and keeps the Verdict with no scores if every attempt is bad', async () => {
  const client = new FakeModelClient(() => scored('against', allScores(0, 0), 'Against held the burden.'));
  expect(await judgeDebate(setup, sixTurns, client)).toEqual({ winner: 'against', reasoning: 'Against held the burden.', scores: [], judges: ['c/judge'] });
  expect(client.calls).toHaveLength(2);
});

test("a good second reply's scores are used", async () => {
  const replies = [scored('for', allScores(0, 0)), scored('for', allScores(8, 6))];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect((await judgeDebate(setup, sixTurns, client)).scores).toEqual(NAMES.map(criterion => ({ criterion, for: 8, against: 6 })));
  expect(client.calls).toHaveLength(2);
});

test('a reply padded with whitespace is parsed in linear time', () => {
  // A model's reply is untrusted: a long run of spaces must not make stripping the fence quadratic.
  const padded = `{${' \t'.repeat(50_000)}x`;
  const started = performance.now();
  expect(parseVerdict(padded, rubric)).toBeNull();
  expect(performance.now() - started).toBeLessThan(100);
  expect(parseVerdict('```\n{"winner":"for","reasoning":"r"}  \n```  ', rubric)).toEqual({ winner: 'for', reasoning: 'r', scores: null });
});

test('rejects draws, wrong Sides and prose', () => {
  for (const t of ['{"winner":"draw","reasoning":"r"}', '{"winner":"pro","reasoning":"r"}', 'For wins.', '{"winner":"for"}'])
    expect(parseVerdict(t, rubric)).toBeNull();
});

test('Judge prompt demands the reasoning in the Motion\'s language and no other', () => {
  const [system] = buildJudgeMessages(setup, sixTurns);
  expect(system?.content).toContain('same language as the Motion');
  expect(system?.content).toContain('never in another language');
});

test('asks again when the reasoning is in another script than the Motion', async () => {
  const replies = ['{"winner":"against","reasoning":"反方在整场辩论中更准确地把握了辩题"}', scored('against', allScores(6, 7), 'Against held the burden.')];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await judgeDebate(setup, sixTurns, client)).toMatchObject({ winner: 'against', reasoning: 'Against held the burden.' });
  expect(client.calls).toHaveLength(2);
});

test('asks for a rewrite, quoting the wrong-language reply, rather than the same question again', async () => {
  const wrong = '{"winner":"against","reasoning":"反方在整场辩论中更准确地把握了辩题"}';
  const replies = [wrong, '{"winner":"against","reasoning":"Against held the burden."}'];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  await judgeDebate(setup, sixTurns, client);
  const retry = client.calls[1]!.messages;
  expect(retry.slice(0, 2)).toEqual(buildJudgeMessages(setup, sixTurns));
  expect(retry[2]).toEqual({ role: 'assistant', content: wrong });
  expect(retry[3]?.role).toBe('user');
  expect(retry[3]?.content).toContain('Remote work beats office work');
  expect(retry[3]?.content).toContain('not in the language of the Motion');
});

test('a reply with bad scores is quoted back with a request for valid scores', async () => {
  const bad = scored('for', allScores(0, 0), 'For was clearer.');
  const replies = [bad, scored('for', allScores(8, 6), 'For was clearer.')];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  await judgeDebate(setup, sixTurns, client);
  const retry = client.calls[1]!.messages;
  expect(retry.slice(0, 2)).toEqual(buildJudgeMessages(setup, sixTurns));
  expect(retry[2]).toEqual({ role: 'assistant', content: bad });
  expect(retry[3]).toEqual({ role: 'user', content: SCORES_REQUEST });
});

test('a reply in the wrong language and with bad scores is asked to fix both', async () => {
  const replies = [scored('for', allScores(0, 0), '正方论证更有力。'), scored('for', allScores(8, 6), 'For was clearer.')];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  await judgeDebate(setup, sixTurns, client);
  const followUp = client.calls[1]!.messages[3]?.content;
  expect(followUp).toContain('not in the language of the Motion');
  expect(followUp).toContain(SCORES_REQUEST);
});

test('the fallback prefers reasoning in the right language over Rubric Scores', async () => {
  const replies = [scored('for', allScores(0, 0), 'For was clearer.'), scored('against', allScores(6, 7), '反方在整场辩论中更准确')];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await judgeDebate(setup, sixTurns, client)).toMatchObject({ winner: 'for', reasoning: 'For was clearer.', scores: [] });
});

test('the fallback keeps Rubric Scores when both replies are in the wrong language', async () => {
  const replies = [scored('for', allScores(8, 6), '正方论证更有力。'), scored('for', allScores(0, 0), '正方论证更有力。')];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect((await judgeDebate(setup, sixTurns, client)).scores).toHaveLength(4);
});

test('accepts reasoning in the Motion\'s own script', async () => {
  const motion = { text: '远程办公优于办公室办公' };
  const client = new FakeModelClient(() => scored('for', allScores(7, 6), '正方论证更有力。'));
  expect(await judgeDebate({ ...setup, motion }, sixTurns, client)).toMatchObject({ reasoning: '正方论证更有力。' });
  expect(client.calls).toHaveLength(1);
});

test('keeps a wrong-language Verdict rather than failing the Debate when every attempt is in another script', async () => {
  const client = new FakeModelClient(() => '{"winner":"for","reasoning":"正方论证更有力。"}');
  expect(await judgeDebate(setup, sixTurns, client)).toMatchObject({ winner: 'for', reasoning: '正方论证更有力。' });
  expect(client.calls).toHaveLength(2);
});

test('retries once, then succeeds', async () => {
  const replies = ['nonsense', scored('for', allScores(7, 6), 'clear')];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await judgeDebate(setup, sixTurns, client)).toEqual({ winner: 'for', reasoning: 'clear', scores: NAMES.map(criterion => ({ criterion, for: 7, against: 6 })), judges: ['c/judge'] });
  expect(client.calls).toHaveLength(2);
  expect(client.calls[0]?.model).toBe('c/judge');
  expect(client.calls[0]?.maxOutputTokens).toBe(1000);
});

test('throws VerdictParseError after two bad replies', async () => {
  await expect(judgeDebate(setup, sixTurns, new FakeModelClient(() => 'draw'))).rejects.toBeInstanceOf(VerdictParseError);
});

test('refuses to judge an unfinished Debate', async () => {
  await expect(judgeDebate(setup, sixTurns.slice(0, 5), new FakeModelClient())).rejects.toBeInstanceOf(DebateNotFinishedError);
});

test('rejects an invalid Panel', async () => {
  await expect(judgeDebate({ ...setup, panel: [] }, sixTurns, new FakeModelClient())).rejects.toBeInstanceOf(InvalidPanelError);
});
