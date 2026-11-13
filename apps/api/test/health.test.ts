import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';

test('health check responds', async () => {
  const res = await exports.default.fetch('https://api.test/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
