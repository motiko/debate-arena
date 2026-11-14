import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { siteUrl } from '../site.mjs';

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

test('the production web Worker is debate-arena-web, the address DEPLOY.md and BETTER_AUTH_URL use', () => {
  const web = readJsonc('../wrangler.jsonc');
  expect(deployedName(web, 'production')).toBe('debate-arena-web');
  const deployDoc = '../../../DEPLOY.md'; // a variable: Vite rewrites literal `new URL('…', import.meta.url)` into asset URLs
  expect(readFileSync(new URL(deployDoc, import.meta.url), 'utf8')).toContain('https://debate-arena-web.<subdomain>.workers.dev');
});

test('canonical URLs use the production address in a production build, localhost otherwise', () => {
  const api = { env: { production: { vars: { BETTER_AUTH_URL: 'https://debate-arena-web.acme.workers.dev' } } } };
  expect(siteUrl('production', api)).toBe('https://debate-arena-web.acme.workers.dev');
  expect(siteUrl(undefined, api)).toBe('http://localhost:4321');
  // Before launch the placeholder is not a URL; the build still works and the release check blocks the deploy.
  expect(siteUrl('production', { env: { production: { vars: { BETTER_AUTH_URL: 'REPLACE_ME_PRODUCTION_URL' } } } })).toBe('https://not-configured.invalid');
});

test('the local web Worker binds the local API Worker', () => {
  const web = readJsonc('../wrangler.jsonc');
  const api = readJsonc('../../api/wrangler.jsonc');
  expect(web.services).toEqual([{ binding: 'API', service: api.name }]);
});
