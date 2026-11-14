import { expect, test } from 'vitest';
import { countWords, trimToLastSentence, truncateToWords } from './words';

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

test('trims a cut-off text back to its last full sentence', () => {
  expect(trimToLastSentence('The first sentence is complete. The second one stops')).toBe('The first sentence is complete.');
  expect(trimToLastSentence('Is it complete? Yes! And then')).toBe('Is it complete? Yes!');
  expect(trimToLastSentence('我喜欢猫和狗。我也喜欢')).toBe('我喜欢猫和狗。');
});

test('keeps text that already ends a sentence', () => {
  expect(trimToLastSentence('One sentence. Another “quoted” one.”')).toBe('One sentence. Another “quoted” one.”');
});

test('keeps the cut text when a full sentence would drop more than half of it', () => {
  const text = 'Short. Then a very long sentence that goes on and on without ever reaching its end';
  expect(trimToLastSentence(text)).toBe(text);
  expect(trimToLastSentence('No sentence end at all')).toBe('No sentence end at all');
});
