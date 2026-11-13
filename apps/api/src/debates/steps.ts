import { generateTurn, judgeDebate, nextSlot, runAiAudience, type ModelClient } from '@debate-arena/engine';
import { appendTurn, completeDebate, failDebate, getDebate, saveVerdict } from '../db/debates';
import { refundQuota, utcDay } from '../db/quota';
import type { DebateEvent } from '../live/events';
import type { StepJob } from './start';

export interface StepDeps {
  db: D1Database;
  client: ModelClient;
  notify: (debateId: string, event: DebateEvent) => Promise<void>;
  enqueue: (job: StepJob) => Promise<void>;
  now: () => Date;
}

export type StepOutcome = 'turn' | 'verdict' | 'complete' | 'skipped';

export const PUBLIC_FAILURE_REASON = 'The Debate could not be completed.';

/**
 * Performs the single next step of a Debate, decided from its stored state, so a redelivered or retried job
 * is safe: a step whose write lost a race returns 'skipped' and leaves the follow-up to the winner.
 */
export async function runStep(deps: StepDeps, job: StepJob): Promise<StepOutcome> {
  const { db, client, notify, enqueue } = deps;
  const debate = await getDebate(db, job.debateId);
  if (!debate || debate.status !== 'running') return 'skipped';
  const { id, setup, turns } = debate;

  if (nextSlot(setup.format, turns)) {
    const turn = await generateTurn(setup, turns, client);
    const slotIndex = turns.length;
    if (!(await appendTurn(db, id, slotIndex, turn))) return 'skipped';
    await notify(id, { type: 'turn', slotIndex, turn });
    await enqueue({ debateId: id });
    return 'turn';
  }

  if (!debate.verdict) {
    const verdict = await judgeDebate(setup, turns, client);
    if (!(await saveVerdict(db, id, verdict))) return 'skipped';
    await notify(id, { type: 'verdict', verdict });
    await enqueue({ debateId: id });
    return 'verdict';
  }

  const aiAudience = debate.aiVoters.length > 0 ? await runAiAudience(setup, turns, debate.aiVoters, client) : null;
  if (!(await completeDebate(db, id, aiAudience, deps.now().toISOString()))) return 'skipped';
  await notify(id, { type: 'complete', aiAudience });
  return 'complete';
}

/**
 * Marks a running Debate failed (storing the internal reason) and tells Viewers, once. Its Quota is refunded
 * only if no model cost was charged, so a Motion crafted to make models fail cannot spend money for free.
 */
export async function failStep(deps: Pick<StepDeps, 'db' | 'notify'>, debateId: string, reason: string): Promise<void> {
  if (!(await failDebate(deps.db, debateId, reason))) return;
  const debate = await getDebate(deps.db, debateId);
  if (debate && debate.costMicroUsd === 0) {
    await refundQuota(deps.db, debate.memberId, debate.quotaPoints, utcDay(debate.createdAt));
  }
  await deps.notify(debateId, { type: 'failed', reason: PUBLIC_FAILURE_REASON });
}
