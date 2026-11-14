import { expect, test } from 'vitest';
import { DebateNotFinishedError, InvalidPanelError, VerdictParseError } from '../errors';
import { FakeModelClient } from '../models/fake';
import { setup, sixTurns } from '../testing/fixtures';
import { buildJudgeMessages, judgeDebate, parseVerdict } from './judge';

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

test('parses plain and fenced JSON', () => {
  expect(parseVerdict('{"winner":"against","reasoning":"r"}')).toEqual({ winner: 'against', reasoning: 'r' });
  expect(parseVerdict('```json\n{"winner":"for","reasoning":"r"}\n```')).toEqual({ winner: 'for', reasoning: 'r' });
});

test('rejects draws, wrong Sides and prose', () => {
  for (const t of ['{"winner":"draw","reasoning":"r"}', '{"winner":"pro","reasoning":"r"}', 'For wins.', '{"winner":"for"}'])
    expect(parseVerdict(t)).toBeNull();
});

test('Judge prompt demands the reasoning in the Motion\'s language and no other', () => {
  const [system] = buildJudgeMessages(setup, sixTurns);
  expect(system?.content).toContain('same language as the Motion');
  expect(system?.content).toContain('never in another language');
});

test('asks again when the reasoning is in another script than the Motion', async () => {
  const replies = ['{"winner":"against","reasoning":"反方在整场辩论中更准确地把握了辩题"}', '{"winner":"against","reasoning":"Against held the burden."}'];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await judgeDebate(setup, sixTurns, client)).toMatchObject({ winner: 'against', reasoning: 'Against held the burden.' });
  expect(client.calls).toHaveLength(2);
});

test('accepts reasoning in the Motion\'s own script', async () => {
  const motion = { text: '远程办公优于办公室办公' };
  const client = new FakeModelClient(() => '{"winner":"for","reasoning":"正方论证更有力。"}');
  expect(await judgeDebate({ ...setup, motion }, sixTurns, client)).toMatchObject({ reasoning: '正方论证更有力。' });
  expect(client.calls).toHaveLength(1);
});

test('keeps a wrong-language Verdict rather than failing the Debate when every attempt is in another script', async () => {
  const client = new FakeModelClient(() => '{"winner":"for","reasoning":"正方论证更有力。"}');
  expect(await judgeDebate(setup, sixTurns, client)).toMatchObject({ winner: 'for', reasoning: '正方论证更有力。' });
  expect(client.calls).toHaveLength(2);
});

test('retries once, then succeeds', async () => {
  const replies = ['nonsense', '{"winner":"for","reasoning":"clear"}'];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await judgeDebate(setup, sixTurns, client)).toEqual({ winner: 'for', reasoning: 'clear', judges: ['c/judge'] });
  expect(client.calls).toHaveLength(2);
  expect(client.calls[0]?.model).toBe('c/judge');
  expect(client.calls[0]?.maxOutputTokens).toBe(800);
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
