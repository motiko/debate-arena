import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// wrangler.jsonc allows // comments; none of ours sit inside strings.
const readJsonc = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));

// `wrangler deploy --env production` names a Worker "<name>-<env>" unless that environment sets its own name.
const deployedName = (config: { name: string; env?: Record<string, { name?: string }> }, env: string) =>
  config.env?.[env]?.name ?? `${config.name}-${env}`;

test('the production web Worker binds the production API Worker', () => {
  const web = readJsonc('../wrangler.jsonc');
  const api = readJsonc('../../api/wrangler.jsonc');
  expect(web.env.production.services).toEqual([{ binding: 'API', service: deployedName(api, 'production') }]);
});

test('the local web Worker binds the local API Worker', () => {
  const web = readJsonc('../wrangler.jsonc');
  const api = readJsonc('../../api/wrangler.jsonc');
  expect(web.services).toEqual([{ binding: 'API', service: api.name }]);
});
