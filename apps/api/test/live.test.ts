import { createExecutionContext, createMessageBatch } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { createDebate } from '../src/db/debates';
import type { StepJob } from '../src/debates/start';
import worker from '../src/index';
import { newDebate } from './helpers';

async function openViewer(debateId: string) {
  const res = await exports.default.fetch(`https://api.test/api/debates/${debateId}/live`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const messages: string[] = [];
  let notify: (() => void) | undefined;
  ws.addEventListener('message', e => {
    messages.push(e.data as string);
    notify?.();
  });
  const next = () =>
    new Promise<unknown>(resolve => {
      const take = () => resolve(JSON.parse(messages.shift()!));
      if (messages.length) take();
      else notify = () => ((notify = undefined), take());
    });
  return { ws, next };
}

test('a Viewer socket receives broadcast events', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const viewer = await openViewer(d.id);
  expect(await env.DEBATE_ROOM.getByName(d.id).broadcast({ type: 'failed', reason: 'test' })).toBe(1);
  expect(await viewer.next()).toEqual({ type: 'failed', reason: 'test' });
  viewer.ws.close();
});

test('ping gets pong', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const viewer = await openViewer(d.id);
  viewer.ws.send('ping');
  expect(await viewer.next()).toEqual({ type: 'pong' });
  viewer.ws.close();
});

test('live route: 426 without an upgrade, 404 for an unknown Debate', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const plain = await exports.default.fetch(`https://api.test/api/debates/${d.id}/live`);
  expect(plain.status).toBe(426);
  expect(await plain.json()).toEqual({ error: 'Expected a WebSocket upgrade' });
  const unknown = await exports.default.fetch('https://api.test/api/debates/nope/live', { headers: { Upgrade: 'websocket' } });
  expect(unknown.status).toBe(404);
});

test('the consumer broadcasts each Turn to the room', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const viewer = await openViewer(d.id);
  const batch = createMessageBatch<StepJob>('debate-steps', [{ id: 'm1', timestamp: new Date(), attempts: 1, body: { debateId: d.id } }]);
  await worker.queue(batch, env, createExecutionContext());
  expect(await viewer.next()).toMatchObject({ type: 'turn', slotIndex: 0, turn: { side: 'for' } });
  viewer.ws.close();
});

test('after a Block the room refuses new sockets and sends nothing', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const room = env.DEBATE_ROOM.getByName(d.id);
  await room.closeForBlock();
  // An upgrade that passed the API's check just before the Block reaches the room just after it.
  const late = await room.fetch(new Request(`https://api.test/api/debates/${d.id}/live`, { headers: { Upgrade: 'websocket' } }));
  expect(late.status).toBe(410);
  expect(await room.broadcast({ type: 'failed', reason: 'test' })).toBe(0);
});

test('blocking tells connected Viewers and closes their sockets', async () => {
  const d = newDebate();
  await createDebate(env.DB, d);
  const viewer = await openViewer(d.id);
  const closed = new Promise<number>(resolve => viewer.ws.addEventListener('close', e => resolve(e.code)));
  const res = await exports.default.fetch(`https://api.test/api/moderation/debates/${d.id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': 'dev-mod-live' },
    body: JSON.stringify({ action: 'block', ground: 'illegal', groundRef: 'StGB §130', explanation: 'Incites hatred against a group.' }),
  });
  expect(res.status).toBe(201);
  expect(await viewer.next()).toEqual({ type: 'blocked' });
  expect(await closed).toBe(4410);
});
