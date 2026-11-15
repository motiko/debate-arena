import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKS, pushesToMain } from './ship.mjs';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const none = '0'.repeat(40);

test('finds the commits pushed to main', () => {
  assert.deepEqual(pushesToMain(`refs/heads/fix ${a} refs/heads/main ${b}\n`), [a]);
});

test('ignores pushes to other branches and deleting a branch', () => {
  assert.deepEqual(pushesToMain(`refs/heads/fix ${a} refs/heads/fix ${none}\n(delete) ${none} refs/heads/main ${b}\n`), []);
});

test('ignores a push with nothing in it', () => {
  assert.deepEqual(pushesToMain(''), []);
});

test('runs the e2e checks, not Lighthouse', () => {
  const commands = CHECKS.map(([command, args]) => [command, ...args].join(' '));
  assert.ok(commands.includes('pnpm check'));
  assert.ok(commands.some(c => c.endsWith(' e2e')));
  assert.ok(commands.every(c => !c.includes('lighthouse')));
});
