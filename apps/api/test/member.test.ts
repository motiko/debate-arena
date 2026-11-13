import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { memberResolver } from '../src/auth/member';
import { getDebate } from '../src/db/debates';
import { signedInHeaders } from './auth-helpers';

const body = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' } };

test('a session starts a Debate as that Member', async () => {
  const { userId, headers } = await signedInHeaders();
  headers.set('content-type', 'application/json');
  const res = await exports.default.fetch('https://api.test/api/debates', { method: 'POST', headers, body: JSON.stringify(body) });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  expect((await getDebate(env.DB, id))?.memberId).toBe(userId);
});

test('with DEV_AUTH "false" the dev header is ignored', async () => {
  const resolve = memberResolver({ ...env, DEV_AUTH: 'false' });
  expect(await resolve(new Request('https://api.test/', { headers: { 'x-dev-member': 'evil' } }))).toBeNull();
});

test('with DEV_AUTH "true" and no session the dev header is used', async () => {
  const resolve = memberResolver({ ...env, DEV_AUTH: 'true' });
  expect(await resolve(new Request('https://api.test/', { headers: { 'x-dev-member': ' dev-1 ' } }))).toBe('dev-1');
});

test('a forged session cookie resolves to no Member', async () => {
  const resolve = memberResolver({ ...env, DEV_AUTH: 'false' });
  const forged = new Request('https://api.test/', { headers: { cookie: 'better-auth.session_token=forged.signature' } });
  expect(await resolve(forged)).toBeNull();
});

test('a session wins over the dev header', async () => {
  const { userId, headers } = await signedInHeaders();
  headers.set('x-dev-member', 'someone-else');
  const resolve = memberResolver({ ...env, DEV_AUTH: 'true' });
  expect(await resolve(new Request('https://api.test/', { headers }))).toBe(userId);
});
