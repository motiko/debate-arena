import { expect, test } from 'vitest';
import { DebateCompleteError, EmptyTurnError, HumanTurnNotSupportedError } from '../errors';
import { FakeModelClient } from '../models/fake';
import { setup, sixTurns } from '../testing/fixtures';
import { countWords } from '../turns/words';
import { generateTurn } from './generate-turn';
import { buildTurnMessages } from './prompts';

test('prompt names the Motion, Side, Phase, word limit and language rule', () => {
  const [system] = buildTurnMessages(setup, { phaseIndex: 0, side: 'for' }, []);
  expect(system?.role).toBe('system');
  for (const s of ['Remote work beats office work', 'For', 'Opening', '300 words', "Motion's language"])
    expect(system?.content).toContain(s);
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
  expect(client.calls[0]?.maxOutputTokens).toBe(Math.ceil(300 * 1.4));
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

test('human Debaters are not generated', async () => {
  const humanSetup = { ...setup, debaters: { ...setup.debaters, for: { kind: 'human', memberId: 'm1' } as const } };
  await expect(generateTurn(humanSetup, [], new FakeModelClient())).rejects.toBeInstanceOf(HumanTurnNotSupportedError);
});
