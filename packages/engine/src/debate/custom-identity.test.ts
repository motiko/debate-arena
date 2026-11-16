import { expect, test } from 'vitest';
import { identityText, parseCustomIdentity } from './custom-identity';

const BAD_NAME = 'Custom Debater name must be 1–40 characters: letters, digits, spaces and simple punctuation';
const BAD_MODEL = 'Custom Debater model must be 1–60 characters: letters, digits, spaces and simple punctuation';

test('a name and model are trimmed', () => {
  expect(parseCustomIdentity({ name: '  Atlas ', model: 'gpt-6' })).toEqual({ name: 'Atlas', model: 'gpt-6' });
});

test('blank or missing fields are absent', () => {
  expect(parseCustomIdentity({ name: '   ' })).toEqual({});
  expect(parseCustomIdentity({})).toEqual({});
});

test('a name over 40 or a model over 60 characters is refused', () => {
  expect(parseCustomIdentity({ name: 'x'.repeat(40) })).toEqual({ name: 'x'.repeat(40) });
  expect(parseCustomIdentity({ name: 'x'.repeat(41) })).toBe(BAD_NAME);
  expect(parseCustomIdentity({ model: 'x'.repeat(61) })).toBe(BAD_MODEL);
});

test('names and model ids people actually use are welcome, in any script', () => {
  expect(parseCustomIdentity({ name: "O'Brien (bot) #2", model: 'qwen2.5:7b' })).toEqual({ name: "O'Brien (bot) #2", model: 'qwen2.5:7b' });
  expect(parseCustomIdentity({ name: 'Zoë', model: 'anthropic/claude-x' })).toEqual({ name: 'Zoë', model: 'anthropic/claude-x' });
  expect(parseCustomIdentity({ name: 'ドラゴン', model: 'llama-3.1-70b' })).toEqual({ name: 'ドラゴン', model: 'llama-3.1-70b' });
});

test.each([
  ['a bidi override', 'Atlas‮gnp'],
  ['a zero-width space', '​'],
  ['a Hangul filler', 'ㅤ'],
  ['a braille blank', '⠀'],
  ['a line separator', 'At las'],
  ['a newline', 'At\nlas'],
  ['only punctuation', '---'],
])('a name with %s is refused, so it cannot hide or disguise itself', (_, name) => {
  expect(parseCustomIdentity({ name })).toBe(BAD_NAME);
});

test('a model with a control character is refused', () => {
  expect(parseCustomIdentity({ model: 'gpt\n6' })).toBe(BAD_MODEL);
});

test('a name that is not a string is refused', () => {
  expect(parseCustomIdentity({ name: 7 })).toBe(BAD_NAME);
});

test('identityText lists only the given fields', () => {
  expect(identityText({ name: 'Atlas' })).toBe('Name: Atlas');
  expect(identityText({ name: 'Atlas', model: 'gpt-6' })).toBe('Name: Atlas\nModel: gpt-6');
});
