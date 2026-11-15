import { FakeModelClient } from '@debate-arena/engine';
import { env, exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { appendTurn, getDebate } from '../src/db/debates';
import { quotaRemaining, spendQuota } from '../src/db/quota';
import { API_TURN_TIMEOUT_SECONDS, runStep, type StepDeps } from '../src/debates/steps';
import type { StepJob } from '../src/debates/start';
import type { DebateEvent } from '../src/live/events';
import { createScreened, newDebate, sampleSetup, turnAt } from './helpers';

const NOW = new Date('2026-11-15T12:00:00Z');
const DEADLINE = new Date(NOW.getTime() + 600_000).toISOString();

function makeDeps(now = NOW) {
  const jobs: StepJob[] = [];
  const later: { job: StepJob; delaySeconds: number }[] = [];
  const events: DebateEvent[] = [];
  const deps: StepDeps = {
    db: env.DB,
    client: new FakeModelClient(() => 'An argument.'),
    notify: async (_id, event) => {
      events.push(event);
    },
    enqueue: async job => {
      jobs.push(job);
    },
    enqueueLater: async (job, delaySeconds) => {
      later.push({ job, delaySeconds });
    },
    now: () => now,
    screener: 'fake-guard/one',
  };
  return { deps, jobs, later, events };
}

const apiFor = () =>
  newDebate({ memberId: `m-${crypto.randomUUID()}`, quotaPoints: 4, setup: { ...sampleSetup, debaters: { ...sampleSetup.debaters, for: { kind: 'api' } } } });

test('the timeout is ten minutes', () => {
  expect(API_TURN_TIMEOUT_SECONDS).toBe(600);
});

test("an API Debater's slot is awaited: a deadline, an awaiting event, a deadline check, no Turn", async () => {
  const { deps, jobs, later, events } = makeDeps();
  const d = apiFor();
  await createScreened(env.DB, d);
  expect(await runStep(deps, { debateId: d.id })).toBe('awaiting');
  expect(events).toEqual([{ type: 'awaiting', slotIndex: 0, deadline: DEADLINE }]);
  expect(later).toEqual([{ job: { debateId: d.id, deadlineFor: 0 }, delaySeconds: 600 }]);
  expect(jobs).toEqual([]);
  const stored = await getDebate(env.DB, d.id);
  expect(stored?.turns).toEqual([]);
  expect(stored?.turnDeadline).toBe(`0@${DEADLINE}`);
});

test('a redelivered step keeps the first deadline', async () => {
  const d = apiFor();
  await createScreened(env.DB, d);
  await runStep(makeDeps().deps, { debateId: d.id });
  const again = makeDeps(new Date(NOW.getTime() + 120_000));
  expect(await runStep(again.deps, { debateId: d.id })).toBe('awaiting');
  expect(again.events).toEqual([{ type: 'awaiting', slotIndex: 0, deadline: DEADLINE }]);
  expect(again.later[0]?.delaySeconds).toBe(480);
  expect((await getDebate(env.DB, d.id))?.turnDeadline).toBe(`0@${DEADLINE}`);
});

test('a missed deadline fails the Debate and refunds its Quota when nothing was spent', async () => {
  const { deps, events } = makeDeps();
  const d = apiFor();
  await spendQuota(env.DB, d.memberId, 4, new Date(d.createdAt));
  await createScreened(env.DB, d);
  await runStep(deps, { debateId: d.id });
  expect(await runStep(deps, { debateId: d.id, deadlineFor: 0 })).toBe('missed');
  const stored = await getDebate(env.DB, d.id);
  expect(stored).toMatchObject({ status: 'failed', failureReason: 'API Debater missed the deadline for slot 0' });
  expect(events.at(-1)).toMatchObject({ type: 'failed' });
  expect(await quotaRemaining(env.DB, d.memberId, new Date(d.createdAt))).toBe(24);
});

test('a deadline check after the Turn arrived does nothing', async () => {
  const { deps } = makeDeps();
  const d = apiFor();
  await createScreened(env.DB, d);
  await runStep(deps, { debateId: d.id });
  await appendTurn(env.DB, d.id, 0, turnAt(0));
  expect(await runStep(deps, { debateId: d.id, deadlineFor: 0 })).toBe('skipped');
  expect((await getDebate(env.DB, d.id))?.status).toBe('running');
});

test('a deadline check never generates a Turn', async () => {
  const { deps, events } = makeDeps();
  const d = newDebate();
  await createScreened(env.DB, d);
  expect(await runStep(deps, { debateId: d.id, deadlineFor: 0 })).toBe('skipped');
  expect(events).toEqual([]);
  expect((await getDebate(env.DB, d.id))?.turns).toEqual([]);
});

test('GET /debates/:id shows the awaited slot while it waits', async () => {
  const d = apiFor();
  await createScreened(env.DB, d);
  const before = (await (await exports.default.fetch(`https://api.test/api/debates/${d.id}`)).json()) as { awaiting: unknown };
  expect(before.awaiting).toBeNull();
  await runStep(makeDeps().deps, { debateId: d.id });
  const view = (await (await exports.default.fetch(`https://api.test/api/debates/${d.id}`)).json()) as { awaiting: unknown };
  expect(view.awaiting).toEqual({ slotIndex: 0, side: 'for', deadline: DEADLINE });
  await appendTurn(env.DB, d.id, 0, turnAt(0));
  const after = (await (await exports.default.fetch(`https://api.test/api/debates/${d.id}`)).json()) as { awaiting: unknown };
  expect(after.awaiting).toBeNull();
});
