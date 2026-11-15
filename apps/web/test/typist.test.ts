import { expect, test } from 'vitest';
import { Typist } from '../src/lib/typist';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('writes a chunk out over time, not all at once', () => {
  const typist = new Typist();
  typist.push(words(20), 0);
  expect(typist.text).toBe('');
  typist.tick(100);
  const early = typist.text.length;
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(words(20).length);
  typist.tick(200);
  expect(typist.text.length).toBeGreaterThan(early);
  expect(words(20).startsWith(typist.text)).toBe(true);
});

test('spreads each chunk over about the time between chunks, so the pen rarely stops', () => {
  const typist = new Typist();
  const full = words(200);
  // Chunks of 60 characters every 600 ms.
  let at = 0;
  for (let end = 60; end <= 600; end += 60, at += 600) {
    typist.push(full.slice(0, end), at);
    for (let t = at; t < at + 600; t += 16) typist.tick(t);
  }
  // After a few chunks the pace has settled: still writing just before the next chunk is due, not long finished.
  typist.push(full.slice(0, 660), at);
  typist.tick(at + 500);
  expect(typist.caughtUp).toBe(false);
  typist.tick(at + 700);
  expect(typist.caughtUp).toBe(true);
});

test('never slower than a floor, so a trickle of words keeps up', () => {
  const typist = new Typist();
  typist.push('Madam Chair', 0);
  typist.tick(400);
  expect(typist.text).toBe('Madam Chair');
});

test('the finished Turn is written out briskly, even after a long gap', () => {
  const typist = new Typist();
  typist.push(words(10), 0);
  typist.tick(2400);
  typist.push(words(10), 2400); // the server's drafts thin out to 2.4 s apart
  typist.push(words(300), 4800, true);
  expect(typist.done).toBe(false);
  typist.tick(4800 + 1200);
  expect(typist.text).toBe(words(300));
  expect(typist.done).toBe(true);
});

test('after waiting for a chunk, the pen starts from where it stopped, not with a leap', () => {
  const typist = new Typist();
  typist.push('Madam', 0);
  typist.tick(500);
  expect(typist.caughtUp).toBe(true);
  typist.push(`Madam ${words(100)}`, 3000);
  typist.tick(3016);
  expect(typist.text.length).toBeLessThan(40);
});

test('a draft that does not continue the text starts over from where they agree', () => {
  const typist = new Typist();
  typist.push('Madam Chair, I rise', 0);
  typist.tick(1000);
  typist.push('Madam Chair, we rise', 1000);
  expect(typist.text).toBe('Madam Chair, ');
});

test('never ends in half a character', () => {
  const typist = new Typist();
  typist.push('a🎙️b', 0);
  for (let t = 0; t < 200; t += 1) {
    typist.tick(t);
    expect(typist.text).not.toMatch(/[\uD800-\uDBFF]$/);
  }
});
