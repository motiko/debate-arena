import { expect, test } from 'vitest';
import { dominantScript } from './script';

test('names the script most letters are written in', () => {
  expect(dominantScript('This house believes nuclear power is essential')).toBe('latin');
  expect(dominantScript('Diese Kammer glaubt, dass Atomkraft unverzichtbar ist')).toBe('latin');
  expect(dominantScript('Эта палата считает атомную энергию необходимой')).toBe('cyrillic');
  expect(dominantScript('反方在整场辩论中更准确地把握了辩题')).toBe('cjk');
  expect(dominantScript('この議院は原子力が不可欠だと考える')).toBe('cjk');
  expect(dominantScript('이 의회는 원자력이 필수적이라고 믿는다')).toBe('hangul');
  expect(dominantScript('هذا المجلس يؤمن بأن الطاقة النووية ضرورية')).toBe('arabic');
});

test('a few foreign words do not change the script', () => {
  expect(dominantScript('反方在整场辩论中更准确地把握了辩题中“essential”一词的含义')).toBe('cjk');
  expect(dominantScript('The word 必要 means essential in this debate')).toBe('latin');
});

test('text without letters has no script', () => {
  expect(dominantScript('2050?')).toBeNull();
  expect(dominantScript('')).toBeNull();
});
