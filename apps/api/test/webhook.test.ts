import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { app } from '../src/app';
import { OpenRouterBatchApi } from '../src/models/batch';
import { verifySignature } from '../src/webhooks/openrouter';

const SECRET = 'whsec-test-secret';

async function sign(body: string, t: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t},${body}`));
  return `t=${t},v1=${[...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

const now = () => Math.floor(Date.now() / 1000);
const event = (batchId: string, type = 'batch.completed') =>
  JSON.stringify({ id: `evt_${crypto.randomUUID()}`, object: 'event', type, created_at: now(), data: { id: batchId } });

function post(body: string, signature: string | null, bindings: Record<string, unknown>) {
  return app.request(
    '/api/webhooks/openrouter',
    { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-openrouter-signature': signature } : {}) }, body },
    { ...env, ...bindings },
  );
}

function queueSpy() {
  const sent: unknown[] = [];
  return { sent, STEP_QUEUE: { send: async (job: unknown) => void sent.push(job) } };
}

async function batchCall(debateId: string, batchId: string) {
  await env.DB.prepare(
    `INSERT INTO batch_calls (debate_id, call_key, model, batch_id, status, created_at, updated_at) VALUES (?, ?, 'a/x', ?, 'pending', ?, ?)`,
  )
    .bind(debateId, `k-${crypto.randomUUID()}`, batchId, new Date().toISOString(), new Date().toISOString())
    .run();
}

test('verifySignature checks the HMAC of "t,body" and the time window', async () => {
  const body = event('batch_1');
  const t = now();
  expect(await verifySignature(SECRET, await sign(body, t), body, t)).toBe(true);
  expect(await verifySignature(SECRET, await sign(body, t), `${body} `, t)).toBe(false);
  expect(await verifySignature(SECRET, await sign(body, t, 'other-secret'), body, t)).toBe(false);
  expect(await verifySignature(SECRET, await sign(body, t - 301), body, t)).toBe(false);
  expect(await verifySignature(SECRET, 'v1=abc', body, t)).toBe(false);
  expect(await verifySignature(SECRET, 'garbage', body, t)).toBe(false);
});

test('a valid signature enqueues the Debate step for that batch', async () => {
  const debateId = `d-${crypto.randomUUID()}`;
  await batchCall(debateId, 'batch_known');
  const body = event('batch_known');
  const queue = queueSpy();
  const res = await post(body, await sign(body, now()), { OPENROUTER_WEBHOOK_SECRET: SECRET, ...queue });
  expect(res.status).toBe(200);
  expect(queue.sent).toEqual([{ debateId }]);
});

test.each(['batch.failed', 'batch.expired', 'batch.cancelled'])('%s also moves the Debate on', async type => {
  const debateId = `d-${crypto.randomUUID()}`;
  await batchCall(debateId, `batch_${type}`);
  const body = event(`batch_${type}`, type);
  const queue = queueSpy();
  await post(body, await sign(body, now()), { OPENROUTER_WEBHOOK_SECRET: SECRET, ...queue });
  expect(queue.sent).toEqual([{ debateId }]);
});

test('a forged or stale signature is refused without revealing the batch', async () => {
  const body = event('batch_known_2');
  const queue = queueSpy();
  for (const signature of [null, await sign(body, now(), 'wrong'), await sign(body, now() - 1000)]) {
    const res = await post(body, signature, { OPENROUTER_WEBHOOK_SECRET: SECRET, ...queue });
    expect(res.status).toBe(401);
  }
  expect(queue.sent).toEqual([]);
});

test('an unknown batch is accepted and ignored', async () => {
  const body = event('batch_nobody_knows');
  const queue = queueSpy();
  const res = await post(body, await sign(body, now()), { OPENROUTER_WEBHOOK_SECRET: SECRET, ...queue });
  expect(res.status).toBe(200);
  expect(queue.sent).toEqual([]);
});

test('without a secret the webhook is off', async () => {
  const body = event('batch_x');
  const res = await post(body, await sign(body, now()), { OPENROUTER_WEBHOOK_SECRET: undefined });
  expect(res.status).toBe(404);
});

test('batches carry the callback URL, before the requests, when configured', async () => {
  let sentBody = '';
  const fetcher = (async (_url: string, init: RequestInit) => {
    sentBody = String(init.body);
    return Response.json({ id: 'batch_1', status: 'validating' }, { status: 202 });
  }) as unknown as typeof fetch;
  const api = new OpenRouterBatchApi('k', { fetcher, callbackUrl: 'https://arena.test/api/webhooks/openrouter' });
  await api.submit({ model: 'a/x', messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 5 });
  expect(JSON.parse(sentBody).callback_url).toBe('https://arena.test/api/webhooks/openrouter');
  expect(sentBody.indexOf('"callback_url"')).toBeLessThan(sentBody.indexOf('"requests"'));
});
