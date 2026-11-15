import { expect, test } from 'vitest';
import { identityText, parseCustomIdentity } from './custom-identity';

const BAD_NAME = 'Custom Debater name must be 1–40 characters, without control characters';
const BAD_MODEL = 'Custom Debater model must be 1–60 characters, without control characters';

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

test('bidi overrides, zero-width and control characters are refused, so a name cannot disguise itself', () => {
  expect(parseCustomIdentity({ name: 'Atlas‮gnp' })).toBe(BAD_NAME);
  expect(parseCustomIdentity({ name: '​' })).toBe(BAD_NAME);
  expect(parseCustomIdentity({ model: 'gpt\n6' })).toBe(BAD_MODEL);
});

test('any script is welcome', () => {
  expect(parseCustomIdentity({ name: 'Zoë', model: 'ドラゴン' })).toEqual({ name: 'Zoë', model: 'ドラゴン' });
});

test('a name that is not a string is refused', () => {
  expect(parseCustomIdentity({ name: 7 })).toBe(BAD_NAME);
});

test('identityText lists only the given fields', () => {
  expect(identityText({ name: 'Atlas' })).toBe('Name: Atlas');
  expect(identityText({ name: 'Atlas', model: 'gpt-6' })).toBe('Name: Atlas\nModel: gpt-6');
});
