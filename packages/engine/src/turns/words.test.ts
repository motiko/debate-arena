import { expect, test } from 'vitest';
import { countWords, truncateToWords } from './words';

test('counts words, ignoring punctuation', () => {
  expect(countWords('Remote work beats office work.')).toBe(5);
  expect(countWords('   ')).toBe(0);
});

test('counts words in languages without spaces', () => {
  expect(countWords('我喜欢猫')).toBeGreaterThan(1);
});

test('leaves text within the limit untouched', () => {
  expect(truncateToWords('One two three.', 3)).toEqual({ text: 'One two three.', truncated: false });
});

test('cuts at the limit, keeping original spacing', () => {
  expect(truncateToWords('One two,  three four five', 3)).toEqual({ text: 'One two,  three', truncated: true });
});
