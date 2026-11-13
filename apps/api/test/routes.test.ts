import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { uniqueId } from './helpers';

const base = 'https://api.test/api';
const body = { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false };

function post(path: string, payload: unknown, headers: Record<string, string> = {}) {
  return exports.default.fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

test('POST /debates without a Member is 401', async () => {
  const res = await post('/debates', body);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Sign in to start a Debate' });
});

test('POST /debates with invalid JSON is 400', async () => {
  const res = await exports.default.fetch(`${base}/debates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': uniqueId('m') },
    body: '{not json',
  });
  expect(res.status).toBe(400);
});

test('POST then GET returns the public view without private fields', async () => {
  const created = await post('/debates', body, { 'x-dev-member': uniqueId('m') });
  expect(created.status).toBe(201);
  const { id, panel, selfJudging } = (await created.json()) as { id: string; panel: string[]; selfJudging: boolean };
  expect(panel).toEqual(['fake-c/one']);
  expect(selfJudging).toBe(false);

  const res = await exports.default.fetch(`${base}/debates/${id}`);
  expect(res.status).toBe(200);
  const view = (await res.json()) as Record<string, unknown>;
  expect(view).toMatchObject({
    id,
    motion: 'Remote work beats office work',
    debaters: { for: { kind: 'ai', model: 'fake-a/one' }, against: { kind: 'ai', model: 'fake-b/one' } },
    panel: ['fake-c/one'],
    aiVoters: [],
    aiVotersShareDebaterModel: false,
    format: { id: 'classic', name: 'Classic' },
  });
  for (const key of ['memberId', 'budgetReservedMicroUsd', 'costMicroUsd', 'quotaPoints']) expect(view).not.toHaveProperty(key);
});

test('the public view lists AI Voters and discloses ones sharing a Debater model', async () => {
  const created = await post('/debates', { ...body, aiVoters: true }, { 'x-dev-member': uniqueId('m') });
  const { id } = (await created.json()) as { id: string };
  const view = (await (await exports.default.fetch(`${base}/debates/${id}`)).json()) as {
    aiVoters: string[];
    aiVotersShareDebaterModel: boolean;
  };
  expect(view.aiVoters).toHaveLength(10);
  expect(view.aiVoters).toContain('fake-a/one'); // also the For Debater
  expect(view.aiVotersShareDebaterModel).toBe(true);
});

test('GET /debates/:id for an unknown id is 404', async () => {
  const res = await exports.default.fetch(`${base}/debates/nope`);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Debate not found' });
});

test('GET /debates lists complete Debates only', async () => {
  const res = await exports.default.fetch(`${base}/debates`);
  expect(res.status).toBe(200);
  const { debates } = (await res.json()) as { debates: { status: string; turns?: unknown }[] };
  for (const d of debates) {
    expect(d.status).toBe('complete');
    expect(d).not.toHaveProperty('turns');
  }
});

test('GET /models lists the fake catalog locally', async () => {
  const res = await exports.default.fetch(`${base}/models`);
  const { models } = (await res.json()) as { models: { id: string; roles: string[] }[] };
  expect(models.map(m => m.id)).toContain('fake-a/one');
  expect(models[0]).not.toHaveProperty('price');
});
