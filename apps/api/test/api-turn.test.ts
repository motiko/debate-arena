import { FakeModelClient } from '@debate-arena/engine';
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, failDebate, getDebate, type DebateRecord } from '../src/db/debates';
import { MAX_API_TURN_BYTES, readTurnBody, relayDraft, screenApiTurn, submitApiTurn, TurnTooLargeError, type ApiTurnDeps } from '../src/debates/api-turn';
import type { StepJob } from '../src/debates/start';
import type { DebateEvent } from '../src/live/events';
import { createApiToken, signedInHeaders } from './auth-helpers';
import { createScreened, newDebate, sampleSetup, turnAt } from './helpers';

const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A body sent in pieces, with a pause before each; a piece may be raw bytes. */
function streamOf(pieces: (string | Uint8Array)[], pauseMs = 0): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= pieces.length) return controller.close();
      if (pauseMs) await sleep(pauseMs);
      const piece = pieces[i++]!;
      controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece);
    },
  });
}

function makeDeps() {
  const events: DebateEvent[] = [];
  const jobs: StepJob[] = [];
  const deps: ApiTurnDeps = {
    db: env.DB,
    notify: async (_id, event) => void events.push(event),
    enqueue: async job => void jobs.push(job),
  };
  return { deps, events, jobs };
}

async function apiDebate(memberId = `m-${crypto.randomUUID()}`): Promise<DebateRecord> {
  const d = newDebate({ memberId, setup: { ...sampleSetup, debaters: { ...sampleSetup.debaters, for: { kind: 'api' } } } });
  await createScreened(env.DB, d);
  return (await getDebate(env.DB, d.id))!;
}

test('readTurnBody decodes a character split across pieces', async () => {
  const bytes = encoder.encode('café.');
  const text = await readTurnBody(streamOf([bytes.slice(0, 4), bytes.slice(4)]), MAX_API_TURN_BYTES, () => {});
  expect(text).toBe('café.');
});

test('readTurnBody refuses a body past the limit', async () => {
  await expect(readTurnBody(streamOf(['x'.repeat(40_000), 'x'.repeat(30_000)]), MAX_API_TURN_BYTES, () => {})).rejects.toBeInstanceOf(
    TurnTooLargeError,
  );
});

test('a whole Turn is stored, announced, and moves the Debate on', async () => {
  const { deps, events, jobs } = makeDeps();
  const d = await apiDebate();
  const r = await submitApiTurn(deps, d, 0, streamOf(['  My opening speech.  ']));
  expect(r).toEqual({ status: 201, slotIndex: 0, turn: { phaseIndex: 0, side: 'for', text: 'My opening speech.', truncated: false } });
  expect((await getDebate(env.DB, d.id))?.turns).toHaveLength(1);
  expect(events.at(-1)).toEqual({ type: 'turn', slotIndex: 0, turn: r.status === 201 ? r.turn : null });
  expect(jobs).toEqual([{ debateId: d.id }]);
});

test('a streamed Turn shows growing drafts, and none after the Turn', async () => {
  const { deps, events } = makeDeps();
  const d = await apiDebate();
  await submitApiTurn(deps, d, 0, streamOf(['One ', 'two ', 'three ', 'four ', 'five.'], 350));
  const drafts = events.filter(e => e.type === 'draft').map(e => (e.type === 'draft' ? e.text : ''));
  expect(drafts.length).toBeGreaterThanOrEqual(2);
  expect(drafts[0]!.length).toBeLessThan(drafts.at(-1)!.length);
  const turnAtIndex = events.findIndex(e => e.type === 'turn');
  expect(events.slice(turnAtIndex + 1).some(e => e.type === 'draft')).toBe(false);
});

test('a long Turn is cut at the word limit, back to its last full sentence', async () => {
  const { deps } = makeDeps();
  const d = await apiDebate();
  const r = await submitApiTurn(deps, d, 0, streamOf([`${'Short sentence here. '.repeat(130)}`]));
  expect(r).toMatchObject({ status: 201, turn: { truncated: true } });
  if (r.status === 201) expect(r.turn.text.endsWith('here.')).toBe(true);
});

test('an empty Turn is refused with 400', async () => {
  const { deps } = makeDeps();
  expect(await submitApiTurn(deps, await apiDebate(), 0, streamOf(['  \n  ']))).toEqual({ status: 400, error: 'The Turn is empty' });
});

test('a Turn past 64 KiB stores nothing and clears its draft', async () => {
  const { deps, events } = makeDeps();
  const d = await apiDebate();
  const r = await submitApiTurn(deps, d, 0, streamOf(['word '.repeat(8000), 'word '.repeat(8000)], 350));
  expect(r).toEqual({ status: 413, error: 'A Turn may be at most 65536 bytes' });
  expect((await getDebate(env.DB, d.id))?.turns).toEqual([]);
  expect(events.at(-1)).toEqual({ type: 'draft', slotIndex: 0, text: '' });
});

test('a body cut off halfway stores nothing, clears its draft, and leaves the slot open', async () => {
  const { deps, events } = makeDeps();
  const d = await apiDebate();
  let sent = 0;
  const broken = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await sleep(350);
      if (sent++ < 2) controller.enqueue(encoder.encode('Half a speech '));
      else controller.error(new Error('client went away'));
    },
  });
  const r = await submitApiTurn(deps, d, 0, broken);
  expect(r).toEqual({ status: 400, error: 'The Turn was cut off before it ended' });
  expect(events.at(-1)).toEqual({ type: 'draft', slotIndex: 0, text: '' });
  const again = await submitApiTurn(deps, (await getDebate(env.DB, d.id))!, 0, streamOf(['Now whole.']));
  expect(again.status).toBe(201);
});

test.each([
  ['a slot not yet reached', 2],
  ["the AI Debater's slot", 1],
])('a Turn for %s is refused with 409', async (_, slot) => {
  const { deps } = makeDeps();
  expect(await submitApiTurn(deps, await apiDebate(), slot, streamOf(['Hello.']))).toEqual({
    status: 409,
    error: `This Debate is not waiting for Turn ${slot}`,
  });
});

test('a Turn for a slot already written is refused with 409', async () => {
  const { deps } = makeDeps();
  const d = await apiDebate();
  await appendTurn(env.DB, d.id, 0, turnAt(0));
  const r = await submitApiTurn(deps, (await getDebate(env.DB, d.id))!, 0, streamOf(['Hello.']));
  expect(r.status).toBe(409);
});

test('a Turn that arrives after the Debate failed (its deadline passed) is refused with 409', async () => {
  const { deps } = makeDeps();
  const d = await apiDebate();
  await failDebate(env.DB, d.id, 'API Debater missed the deadline for slot 0');
  expect((await submitApiTurn(deps, (await getDebate(env.DB, d.id))!, 0, streamOf(['Late.']))).status).toBe(409);
});

test('a Turn that loses the race to another submission is refused with 409', async () => {
  const { deps } = makeDeps();
  const d = await apiDebate();
  const slow = submitApiTurn(deps, d, 0, streamOf(['First ', 'one.'], 200));
  const fast = await submitApiTurn(deps, d, 0, streamOf(['Second one.']));
  expect(fast.status).toBe(201);
  expect((await slow).status).toBe(409);
  expect((await getDebate(env.DB, d.id))?.turns[0]?.text).toBe('Second one.');
});

test('a draft is relayed cut to the word limit', async () => {
  const { deps, events } = makeDeps();
  const d = await apiDebate();
  expect(await relayDraft(deps, d, 0, streamOf([`${'word '.repeat(400)}`]))).toEqual({ status: 204 });
  const draft = events.at(-1);
  expect(draft?.type).toBe('draft');
  if (draft?.type === 'draft') expect(draft.text.split(' ')).toHaveLength(300);
  expect(await relayDraft(deps, d, 1, streamOf(['Not mine.']))).toEqual({ status: 409, error: 'This Debate is not waiting for Turn 1' });
});

test('a flagged API Turn Unlists the Debate', async () => {
  const d = await apiDebate();
  const client = new FakeModelClient(() => 'unsafe\nS10');
  await screenApiTurn(async () => ({ client, screener: 'fake-guard/one' }), env.DB, d.id, 'Something hateful');
  expect(await getDebate(env.DB, d.id)).toMatchObject({ flagged: true, visibility: 'unlisted' });
});

test('an API Turn that cannot be screened at all Flags the Debate (fails closed)', async () => {
  const d = await apiDebate();
  await screenApiTurn(
    async () => {
      throw new Error('catalog unavailable');
    },
    env.DB,
    d.id,
    'Anything',
  );
  expect(await getDebate(env.DB, d.id)).toMatchObject({ flagged: true, visibility: 'unlisted' });
});

test('a safe API Turn changes nothing', async () => {
  const d = await apiDebate();
  await screenApiTurn(async () => ({ client: new FakeModelClient(() => 'safe'), screener: 'fake-guard/one' }), env.DB, d.id, 'A fine speech');
  expect(await getDebate(env.DB, d.id)).toMatchObject({ flagged: false, visibility: 'listed' });
});

const base = 'https://api.test/api';
const post = (path: string, body: string, headers: Record<string, string> | Headers, method = 'POST') =>
  exports.default.fetch(`${base}${path}`, { method, headers: { 'content-type': 'text/plain; charset=utf-8', ...Object.fromEntries(new Headers(headers)) }, body });

test('POST /debates/:id/turns/:slot with the starter\'s API token stores the Turn', async () => {
  const { userId, headers } = await signedInHeaders();
  const { key } = await createApiToken(headers);
  const d = await apiDebate(userId);
  const res = await post(`/debates/${d.id}/turns/0`, 'A speech through the API.', { authorization: `Bearer ${key}` });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ slotIndex: 0, turn: { text: 'A speech through the API.' } });
});

test('a session cookie alone cannot submit a Turn', async () => {
  const { userId, headers } = await signedInHeaders();
  const d = await apiDebate(userId);
  const res = await post(`/debates/${d.id}/turns/0`, 'Forged from another site.', headers);
  expect(res.status).toBe(401);
});

test("another Member's token is refused with 403, JSON with 415, an unknown Debate with 404", async () => {
  const d = await apiDebate('m-owner');
  expect((await post(`/debates/${d.id}/turns/0`, 'Mine?', { 'x-dev-member': 'm-other' })).status).toBe(403);
  const json = await exports.default.fetch(`${base}/debates/${d.id}/turns/0`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': 'm-owner' },
    body: JSON.stringify({ text: 'x' }),
  });
  expect(json.status).toBe(415);
  expect((await post('/debates/nope/turns/0', 'Hello.', { 'x-dev-member': 'm-owner' })).status).toBe(404);
});

test('PUT /debates/:id/turns/:slot/draft relays a draft (204)', async () => {
  const d = await apiDebate('m-drafter');
  const res = await post(`/debates/${d.id}/turns/0/draft`, 'Half a', { 'x-dev-member': 'm-drafter' }, 'PUT');
  expect(res.status).toBe(204);
  const wrong = await post(`/debates/${d.id}/turns/1/draft`, 'Half a', { 'x-dev-member': 'm-drafter' }, 'PUT');
  expect(wrong.status).toBe(409);
});
