import { expect, test } from 'vitest';
import { DebateNotFinishedError, StanceParseError } from '../errors';
import { FakeModelClient } from '../models/fake';
import { setup, sixTurns } from '../testing/fixtures';
import { castAiStance, parseStance, runAiAudience } from './ai-voter';

test('parses stances leniently but strictly by word', () => {
  expect(parseStance('Against.')).toBe('against');
  expect(parseStance('  FOR ')).toBe('for');
  expect(parseStance('undecided')).toBe('undecided');
  expect(parseStance('I think for')).toBeNull();
  expect(parseStance('')).toBeNull();
});

test('before-stance sees only the Motion; after-stance sees the Turns', async () => {
  const client = new FakeModelClient(() => 'for');
  await castAiStance(setup.motion, 'x/v', client);
  await castAiStance(setup.motion, 'x/v', client, sixTurns);
  expect(JSON.stringify(client.calls[0]?.messages)).toContain('Remote work beats office work');
  expect(JSON.stringify(client.calls[0]?.messages)).not.toContain(sixTurns[0]!.text);
  expect(JSON.stringify(client.calls[1]?.messages)).toContain(sixTurns[0]!.text);
  expect(client.calls[0]?.maxOutputTokens).toBe(10);
});

test('AI Audience Result is an Oxford result over all AI Voters', async () => {
  // before-stances (no transcript) reply 'undecided'; after-stances reply 'against'
  const client = new FakeModelClient(r =>
    JSON.stringify(r.messages).includes(sixTurns[0]!.text) ? 'against' : 'undecided');
  const r = await runAiAudience(setup, sixTurns, ['x/v', 'x/v'], client);
  expect(r).toEqual({ counted: 2, swing: { for: 0, against: 100 }, winner: 'against' });
});

test('retries once on a bad reply', async () => {
  const replies = ['maybe', 'for'];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await castAiStance(setup.motion, 'x/v', client)).toBe('for');
});

test('throws StanceParseError after two bad replies', async () => {
  await expect(castAiStance(setup.motion, 'x/v', new FakeModelClient(() => 'maybe'))).rejects.toBeInstanceOf(StanceParseError);
});

test('an unfinished Debate cannot be voted on', async () => {
  await expect(runAiAudience(setup, sixTurns.slice(0, 2), ['x/v'], new FakeModelClient(() => 'for')))
    .rejects.toBeInstanceOf(DebateNotFinishedError);
});
