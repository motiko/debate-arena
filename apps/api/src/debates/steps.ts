import {
  generateTurn,
  isApiSlot,
  judgeDebate,
  nextSlot,
  runAiAudience,
  screenMotion,
  type ModelClient,
  type ModelId,
  type Turn,
} from '@debate-arena/engine';
import { appendTurn, awaitingOf, completeDebate, failDebate, getDebate, saveVerdict, setTurnDeadline } from '../db/debates';
import { saveScreen } from '../db/moderation';
import { refundQuota, utcDay } from '../db/quota';
import { BudgetExhaustedError } from '../models/factory';
import { createDraftSender } from '../live/drafts';
import type { DebateEvent } from '../live/events';
import type { StepJob } from './start';

export interface StepDeps {
  db: D1Database;
  client: ModelClient;
  notify: (debateId: string, event: DebateEvent) => Promise<void>;
  enqueue: (job: StepJob) => Promise<void>;
  /** Queues a job to run after a delay: an API slot's deadline check. */
  enqueueLater: (job: StepJob, delaySeconds: number) => Promise<void>;
  now: () => Date;
  /** The model that screens Motions (catalog role 'screener'). */
  screener: ModelId;
  /** Screens Motions; defaults to `client`. A Batch Debate screens with a normal call, as the screener has no batch. */
  screenClient?: ModelClient;
  /** Errors meaning "not ready yet" (a Batch Debate's pending batch call): passed through, never counted as failures. */
  isPending?: (error: unknown) => boolean;
}

export type StepOutcome = 'screen' | 'turn' | 'awaiting' | 'missed' | 'verdict' | 'complete' | 'skipped';

/** How long an API Debater has for each Turn. */
export const API_TURN_TIMEOUT_SECONDS = 600;

export const PUBLIC_FAILURE_REASON = 'The Debate could not be completed.';

/**
 * Performs the single next step of a Debate, decided from its stored state, so a redelivered or retried job
 * is safe: a step whose write lost a race returns 'skipped' and leaves the follow-up to the winner.
 */
export async function runStep(deps: StepDeps, job: StepJob): Promise<StepOutcome> {
  const { db, client, notify, enqueue } = deps;
  const debate = await getDebate(db, job.debateId);
  // A Blocked Debate is also marked failed by the Block; checking both keeps a stale step from going on.
  if (!debate || debate.status !== 'running' || debate.visibility === 'blocked') return 'skipped';
  const { id, setup, turns } = debate;

  // A deadline check only ever fails a Debate whose API slot is still empty; it never moves a Debate on.
  if (job.deadlineFor !== undefined) {
    if (turns.length !== job.deadlineFor || awaitingOf(debate)?.slotIndex !== job.deadlineFor) return 'skipped';
    await failStep(deps, id, `API Debater missed the deadline for slot ${job.deadlineFor}`);
    return 'missed';
  }

  // First, screen the Motion. A Flag Unlists the Debate but it runs on; Viewers are not told.
  if (debate.screenedAt === null) {
    const result = await screenMotion(setup.motion.text, deps.screener, deps.screenClient ?? client, {
      rethrow: error => error instanceof BudgetExhaustedError,
    });
    if (!(await saveScreen(db, id, result, deps.now().toISOString()))) return 'skipped';
    await enqueue({ debateId: id });
    return 'screen';
  }

  const slot = nextSlot(setup.format, turns);
  if (slot && isApiSlot(setup, slot)) {
    // The Turn comes through the API (POST /debates/:id/turns/:slot), which moves the Debate on. Until the deadline.
    const slotIndex = turns.length;
    const now = deps.now();
    const deadline = await setTurnDeadline(db, id, slotIndex, new Date(now.getTime() + API_TURN_TIMEOUT_SECONDS * 1000).toISOString());
    if (!deadline) return 'skipped';
    await notify(id, { type: 'awaiting', slotIndex, deadline });
    const left = Math.max(0, Math.ceil((Date.parse(deadline) - now.getTime()) / 1000));
    await deps.enqueueLater({ debateId: id, deadlineFor: slotIndex }, left);
    return 'awaiting';
  }

  if (slot) {
    const slotIndex = turns.length;
    // Viewers see the Turn as it is written. The last draft never follows the Turn itself, and a Turn that fails
    // (written or stored) clears its draft, so a retry starts from an empty seat. A Slow Debate's notify does nothing.
    const drafts = createDraftSender(text => notify(id, { type: 'draft', slotIndex, text }));
    let drafted = false;
    let turn: Turn;
    try {
      turn = await generateTurn(setup, turns, client, {
        onDraft: text => {
          drafted = true;
          drafts.push(text);
        },
      });
      await drafts.stop();
      if (!(await appendTurn(db, id, slotIndex, turn))) return 'skipped';
    } catch (error) {
      await drafts.stop();
      if (drafted) await notify(id, { type: 'draft', slotIndex, text: '' });
      throw error;
    }
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

  const aiAudience =
    debate.aiVoters.length > 0
      ? await runAiAudience(setup, turns, debate.aiVoters, client, deps.isPending ? { rethrow: deps.isPending } : {})
      : null;
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
  // A Batch Debate's batches are paid when sent, but charged here only when their results arrive.
  const sentBatches = await deps.db
    .prepare('SELECT 1 AS x FROM batch_calls WHERE debate_id = ? AND batch_id IS NOT NULL LIMIT 1')
    .bind(debateId)
    .first();
  if (debate && debate.costMicroUsd === 0 && !sentBatches) {
    await refundQuota(deps.db, debate.memberId, debate.quotaPoints, utcDay(debate.createdAt));
  }
  await deps.notify(debateId, { type: 'failed', reason: PUBLIC_FAILURE_REASON });
}
