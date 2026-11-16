import { expect, test } from 'vitest';
import { DebateNotFinishedError, StanceParseError } from '../errors';
import type { ModelClient } from '../models/client';
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
  const vote = { model: 'x/v', before: 'undecided', after: 'against' };
  expect(r).toEqual({ counted: 2, swing: { for: 0, against: 100 }, winner: 'against', dropped: [], votes: [vote, vote] });
});

test("runAiAudience lists each counted voter's model and votes, in voter order", async () => {
  const client = new FakeModelClient(r => {
    if (r.model === 'b/y') return 'maybe';
    const after = JSON.stringify(r.messages).includes(sixTurns[0]!.text);
    return r.model === 'a/x' ? (after ? 'for' : 'undecided') : after ? 'against' : 'for';
  });
  const r = await runAiAudience(setup, sixTurns, ['a/x', 'b/y', 'c/z'], client);
  expect(r.votes).toEqual([
    { model: 'a/x', before: 'undecided', after: 'for' },
    { model: 'c/z', before: 'for', after: 'against' },
  ]);
  expect(r.dropped).toEqual(['1:b/y']);
  expect(r.counted).toBe(r.votes.length);
});

test('an AI Voter that never gives a valid stance is dropped, not fatal', async () => {
  const client = new FakeModelClient(r => (r.model === 'bad/v' ? 'maybe' : 'for'));
  const r = await runAiAudience(setup, sixTurns, ['x/v', 'bad/v'], client);
  expect(r.counted).toBe(1);
  expect(r.dropped).toEqual(['1:bad/v']); // surfaced, so a manipulated result can be detected and disclosed
});

test('an AI Voter whose model call fails (e.g. a provider outage) is dropped, not fatal', async () => {
  const client: ModelClient = {
    complete: async r => {
      if (r.model === 'down/v') throw new Error('503 Service Unavailable');
      return { text: 'for', inputTokens: 1, outputTokens: 1 };
    },
  };
  const r = await runAiAudience(setup, sixTurns, ['x/v', 'down/v'], client);
  expect(r.counted).toBe(1);
  expect(r.dropped).toEqual(['1:down/v']);
});

test('retries once on a bad reply', async () => {
  const replies = ['maybe', 'for'];
  const client = new FakeModelClient(() => replies.shift() ?? '');
  expect(await castAiStance(setup.motion, 'x/v', client)).toBe('for');
});

test('throws StanceParseError after two bad replies', async () => {
  await expect(castAiStance(setup.motion, 'x/v', new FakeModelClient(() => 'maybe'))).rejects.toBeInstanceOf(StanceParseError);
});

test('a rethrown error is not a dropped voter, and every voter was asked first', async () => {
  class Pending extends Error {}
  const asked: string[] = [];
  const client: ModelClient = {
    complete: async request => {
      asked.push(request.model);
      if (request.model === 'x/slow') throw new Pending('not ready');
      return { text: 'for', inputTokens: 1, outputTokens: 1 };
    },
  };
  await expect(
    runAiAudience(setup, sixTurns, ['a/one', 'x/slow', 'b/two'], client, { rethrow: e => e instanceof Pending }),
  ).rejects.toBeInstanceOf(Pending);
  expect(new Set(asked)).toEqual(new Set(['a/one', 'x/slow', 'b/two']));
});

test('an unfinished Debate cannot be voted on', async () => {
  await expect(runAiAudience(setup, sixTurns.slice(0, 2), ['x/v'], new FakeModelClient(() => 'for')))
    .rejects.toBeInstanceOf(DebateNotFinishedError);
});
