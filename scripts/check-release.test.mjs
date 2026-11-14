import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPlaceholders } from './check-release.mjs';

const wrangler = `{
  "name": "debate-arena-api",
  // A comment mentioning REPLACE_ME_IGNORED outside production.
  "vars": { "BETTER_AUTH_URL": "http://localhost:8787" },
  "env": {
    "production": {
      "vars": { "BETTER_AUTH_URL": "REPLACE_ME_PRODUCTION_URL" },
      "d1_databases": [{ "database_id": "REPLACE_ME_D1_ID" }]
    },
    "staging": { "vars": { "X": "REPLACE_ME_STAGING" } }
  }
}`;

test('finds placeholders with file and line', () => {
  const found = findPlaceholders([{ path: 'apps/api/wrangler.jsonc', text: wrangler, section: 'env.production' }]);
  assert.deepEqual(found, [
    { path: 'apps/api/wrangler.jsonc', line: 7, token: 'REPLACE_ME_PRODUCTION_URL' },
    { path: 'apps/api/wrangler.jsonc', line: 8, token: 'REPLACE_ME_D1_ID' },
  ]);
});

test('ignores placeholders outside env.production', () => {
  const found = findPlaceholders([{ path: 'w.jsonc', text: wrangler, section: 'env.production' }]);
  assert.ok(found.every(f => f.token !== 'REPLACE_ME_IGNORED' && f.token !== 'REPLACE_ME_STAGING'));
});

test('scans a whole file without a section', () => {
  const found = findPlaceholders([{ path: 'operator.ts', text: "export const OPERATOR = {\n  name: 'REPLACE_ME_OPERATOR_NAME',\n};\n" }]);
  assert.deepEqual(found, [{ path: 'operator.ts', line: 2, token: 'REPLACE_ME_OPERATOR_NAME' }]);
});

test('a comment that only mentions REPLACE_ME is not a placeholder', () => {
  const text = '// Fill in every REPLACE_ME value before launch.\nexport const X = 1;\n';
  assert.deepEqual(findPlaceholders([{ path: 'operator.ts', text }]), []);
});

test('passes a clean config', () => {
  const clean = wrangler.replaceAll('REPLACE_ME_PRODUCTION_URL', 'https://x.workers.dev').replaceAll('REPLACE_ME_D1_ID', 'abc');
  assert.deepEqual(findPlaceholders([{ path: 'w.jsonc', text: clean, section: 'env.production' }]), []);
});
