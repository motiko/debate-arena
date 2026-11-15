import { expect, test, vi } from 'vitest';
import { ApiTurnError, DebateCompleteError, EmptyTurnError, HumanTurnNotSupportedError } from '../errors';
import { FakeModelClient } from '../models/fake';
import { setup, sixTurns } from '../testing/fixtures';
import { countWords } from '../turns/words';
import { utf8Length } from '../budget/estimate';
import { generateTurn, isApiSlot, submittedTurn } from './generate-turn';
import { buildTurnMessages } from './prompts';

test('prompt names the Motion, Side, Phase, word limit and language rule', () => {
  const [system] = buildTurnMessages(setup, { phaseIndex: 0, side: 'for' }, []);
  expect(system?.role).toBe('system');
  for (const s of ['Remote work beats office work', 'For', 'Opening', 'never exceed 300 words', 'same language as the Motion'])
    expect(system?.content).toContain(s);
});

test('prompt asks for a length well below the limit, since models overshoot word counts', () => {
  const phases = setup.format.phases.map((_, phaseIndex) => buildTurnMessages(setup, { phaseIndex, side: 'for' }, sixTurns)[0]?.content);
  // Classic: 300 / 200 / 150 words; asked for 70% of each
  expect(phases[0]).toContain('Aim for about 210 words');
  expect(phases[1]).toContain('Aim for about 140 words');
  expect(phases[2]).toContain('Aim for about 105 words');
});

test('prior Turns are passed in order', () => {
  const messages = buildTurnMessages(setup, { phaseIndex: 1, side: 'for' }, sixTurns.slice(0, 2));
  const user = messages.find(m => m.role === 'user')?.content ?? '';
  const first = user.indexOf(sixTurns[0]!.text);
  const second = user.indexOf(sixTurns[1]!.text);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(second).toBeGreaterThan(first);
});

test('first Turn uses the For Debater and the Opening limit', async () => {
  const client = new FakeModelClient();
  const t = await generateTurn(setup, [], client);
  expect(t).toMatchObject({ phaseIndex: 0, side: 'for', truncated: false });
  expect(client.calls[0]?.model).toBe('a/for-model');
  // 2x headroom over 300 words × 1.4 tokens, so the word limit (not the token cap) cuts the Turn
  expect(client.calls[0]?.maxOutputTokens).toBe(840);
});

test('a Turn cut off by the token cap is marked truncated', async () => {
  const client = new FakeModelClient(() => ({ text: 'A reply that stops mid', finishReason: 'length' }));
  const t = await generateTurn(setup, [], client);
  expect(t.text).toBe('A reply that stops mid');
  expect(t.truncated).toBe(true);
});

test('a Turn cut off by the token cap ends at its last full sentence', async () => {
  const client = new FakeModelClient(() => ({ text: 'Commutes waste hours every single day. Net zero by', finishReason: 'length' }));
  const t = await generateTurn(setup, [], client);
  expect(t).toMatchObject({ text: 'Commutes waste hours every single day.', truncated: true });
});

test('an over-long reply is cut at the last full sentence within the limit', async () => {
  const reply = `${'word '.repeat(250)}ends here. Then ${'more '.repeat(100)}`;
  const t = await generateTurn(setup, [], new FakeModelClient(() => reply));
  expect(t.text.endsWith('ends here.')).toBe(true);
  expect(countWords(t.text)).toBe(252);
  expect(t.truncated).toBe(true);
});

test('second Turn uses the Against Debater', async () => {
  const client = new FakeModelClient();
  await generateTurn(setup, sixTurns.slice(0, 1), client);
  expect(client.calls[0]?.model).toBe('b/against-model');
});

test('over-long replies are cut at the Phase limit', async () => {
  const t = await generateTurn(setup, [], new FakeModelClient(() => 'word '.repeat(400)));
  expect(countWords(t.text)).toBe(300);
  expect(t.truncated).toBe(true);
});

test('empty replies throw EmptyTurnError', async () => {
  await expect(generateTurn(setup, [], new FakeModelClient(() => '  \n'))).rejects.toBeInstanceOf(EmptyTurnError);
});

test('a finished Debate has no next Turn', async () => {
  await expect(generateTurn(setup, sixTurns, new FakeModelClient())).rejects.toBeInstanceOf(DebateCompleteError);
});

test('API Debaters are not generated', async () => {
  const apiSetup = { ...setup, debaters: { ...setup.debaters, for: { kind: 'api' } as const } };
  await expect(generateTurn(apiSetup, [], new FakeModelClient())).rejects.toBeInstanceOf(ApiTurnError);
});

test("isApiSlot tells an API Debater's slots", () => {
  const apiSetup = { ...setup, debaters: { ...setup.debaters, against: { kind: 'api' } as const } };
  expect(isApiSlot(apiSetup, { phaseIndex: 0, side: 'against' })).toBe(true);
  expect(isApiSlot(apiSetup, { phaseIndex: 0, side: 'for' })).toBe(false);
});

test('submittedTurn stores a text in the next slot, trimmed', () => {
  expect(submittedTurn(setup, [], '  A short speech.  ')).toEqual({ phaseIndex: 0, side: 'for', text: 'A short speech.', truncated: false });
  expect(submittedTurn(setup, sixTurns.slice(0, 3), 'Next.')).toMatchObject({ phaseIndex: 1, side: 'against' });
});

test('submittedTurn cuts a long text at the word limit, back to its last full sentence', () => {
  const long = `${'One sentence here. '.repeat(100)}`; // 300 words of Opening limit, 300 here
  const turn = submittedTurn(setup, [], `${long} And then some more words without end`);
  expect(turn.truncated).toBe(true);
  expect(turn.text.endsWith('here.')).toBe(true);
  expect(countWords(turn.text)).toBeLessThanOrEqual(300);
});

test('submittedTurn cuts a text padded with symbols to its byte cap, back to its last full sentence', () => {
  // 300 "words" of 40 symbols each would be 12 kB: far more tokens than the Budget reserves for a Turn.
  const padded = Array.from({ length: 300 }, (_, i) => `${'%'.repeat(39)}${i % 10 === 9 ? '.' : '%'}`).join(' ');
  const turn = submittedTurn(setup, [], padded);
  expect(turn.truncated).toBe(true);
  expect(utf8Length(turn.text)).toBeLessThanOrEqual(2400);
  expect(turn.text.endsWith('.')).toBe(true);
});

test('submittedTurn never splits a character at the byte cap', () => {
  const emoji = Array.from({ length: 300 }, () => '😀😀😀').join(' '); // 13 bytes a word
  const turn = submittedTurn(setup, [], emoji);
  expect(utf8Length(turn.text)).toBeLessThanOrEqual(2400);
  expect(turn.text).not.toContain('�');
  expect([...turn.text].every(ch => ch === '😀' || ch === ' ')).toBe(true);
});

test('submittedTurn refuses an empty text and a finished Debate', () => {
  expect(() => submittedTurn(setup, [], '  \n ')).toThrow(EmptyTurnError);
  expect(() => submittedTurn(setup, sixTurns, 'Too late.')).toThrow(DebateCompleteError);
});

test('human Debaters are not generated', async () => {
  const humanSetup = { ...setup, debaters: { ...setup.debaters, for: { kind: 'human', memberId: 'm1' } as const } };
  await expect(generateTurn(humanSetup, [], new FakeModelClient())).rejects.toBeInstanceOf(HumanTurnNotSupportedError);
});

test('reports drafts as the Turn is written, cut to the Phase word limit', async () => {
  const drafts: string[] = [];
  const long = Array.from({ length: 320 }, (_, i) => `w${i}`).join(' ') + '.';
  await generateTurn(setup, [], new FakeModelClient(() => long), { onDraft: d => drafts.push(d) });
  expect(drafts.length).toBeGreaterThan(1);
  expect(countWords(drafts.at(-1)!)).toBe(300); // Opening maxWords
  expect(drafts.every(d => countWords(d) <= 300)).toBe(true);
});

test('without onDraft, asks the client without a stream', async () => {
  const client = new FakeModelClient();
  const spy = vi.spyOn(client, 'complete');
  await generateTurn(setup, [], client);
  expect(spy.mock.calls[0]?.[1]).toBeUndefined();
});
