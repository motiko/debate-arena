import { MAX_ATTEMPTS } from '@debate-arena/engine';
import { addCost, getBudget } from '../db/debates';
import type { DebateEvent } from '../live/events';
import { BatchCallFailedError, BatchPendingError, type BatchApi } from '../models/batch';
import { catalogFor, priceTable, screenerFor, type DebateKind } from '../models/catalog';
import { deferredClient } from '../models/deferred';
import { BudgetExhaustedError, createBatchApi, createModels, meteredClient } from '../models/factory';
import type { StepJob } from './start';
import { failStep, runStep, type StepDeps } from './steps';

const RETRY_DELAY_SECONDS = 5;

/**
 * How long a Batch Debate's step waits before looking at its batch calls again: from a minute, doubling, at most
 * 15 minutes (batch results take minutes to hours). With fake models, 2 s.
 */
export function pollDelaySeconds(waits: number, provider: string): number {
  if (provider === 'fake') return 2;
  return Math.min(60 * 2 ** waits, 900);
}

/**
 * Live updates are best-effort: Viewers can always reload state over HTTP. A failed broadcast must not
 * spend a retry, because the retried message would move on to the next step and this event would be lost anyway.
 */
async function notifyViewers(env: Env, debateId: string, event: DebateEvent): Promise<void> {
  try {
    await env.DEBATE_ROOM.getByName(debateId).broadcast(event);
  } catch (error) {
    console.warn(`Could not broadcast ${event.type} for Debate ${debateId}`, error);
  }
}

/**
 * How often a Batch Debate's step may wait for batch results (about two days at the 15-minute cap) before the
 * Debate fails: a backstop, since OpenRouter promises results within 24 h.
 */
export const MAX_BATCH_WAITS = 200;

/**
 * Queue handler: runs one Debate step per message. A failing step is retried once, then the Debate fails;
 * a Debate that has used up its Budget fails at once. A Batch Debate's step that waits for batch results is
 * sent again later; its attempt count travels with it, so waiting can never reset the retry limit.
 */
export async function consumer(
  batch: MessageBatch<StepJob>,
  env: Env,
  _ctx: ExecutionContext,
  overrides: { batchApi?: BatchApi } = {},
): Promise<void> {
  const modelEnv = env as Env & { OPENROUTER_API_KEY?: string };
  const models = createModels(modelEnv);
  const prices = priceTable(models.catalog);
  const batchPrices = priceTable(catalogFor(models.catalog, 'batch'));

  for (const message of batch.messages) {
    const { debateId } = message.body;
    // Enforce the reserved Budget where money is spent: no new model call once spending has reached it.
    // A live call already in flight can overshoot by at most that one call; a Batch Debate's calls are charged when
    // their results arrive, so several submitted ones can overshoot, still within the worst case reserved.
    const budgetGuard = async () => {
      const budget = await getBudget(env.DB, debateId);
      if (budget && budget.spentMicroUsd >= budget.reservedMicroUsd) {
        throw new BudgetExhaustedError(`Spent ${budget.spentMicroUsd} of ${budget.reservedMicroUsd} micro-USD`);
      }
    };
    const kind = (await env.DB.prepare('SELECT kind FROM debates WHERE id = ?').bind(debateId).first<{ kind: DebateKind }>())?.kind;
    const live = meteredClient(models.client, prices, cost => addCost(env.DB, debateId, cost), budgetGuard);
    const batchDebate = kind === 'batch';
    const deferred = batchDebate
      ? deferredClient({
          db: env.DB,
          debateId,
          api: overrides.batchApi ?? createBatchApi(modelEnv),
          prices: batchPrices,
          onCost: cost => addCost(env.DB, debateId, cost),
          guard: budgetGuard,
        })
      : null;
    const deps: StepDeps = {
      db: env.DB,
      // A Batch Debate's Debate, Judge and AI Voter calls go through the Batch API at batch prices.
      client: deferred ?? live,
      screenClient: live,
      isPending: error => error instanceof BatchPendingError,
      // Batch Debates have no live stream: they are published only when complete.
      notify: batchDebate ? async () => {} : (id, event) => notifyViewers(env, id, event),
      enqueue: async job => {
        await env.STEP_QUEUE.send(job);
      },
      now: () => new Date(),
      screener: screenerFor(models.catalog),
    };
    // The step's attempt: a re-sent Batch Debate step carries it, as a new message starts again at 1.
    const attempt = Math.max(message.attempts, message.body.attempt ?? 1);
    const reason = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    try {
      await runStep(deps, message.body);
      message.ack();
    } catch (error) {
      if (error instanceof BatchPendingError) {
        const waits = message.body.waits ?? 0;
        if (waits >= MAX_BATCH_WAITS) {
          await failStep(deps, debateId, `Batch results did not arrive after ${waits} waits`);
        } else {
          // Waiting for batch results is not a failure: look again later, without using a retry attempt.
          await env.STEP_QUEUE.send({ debateId, waits: waits + 1, attempt }, { delaySeconds: pollDelaySeconds(waits, env.MODEL_PROVIDER) });
        }
        message.ack();
        continue;
      }
      if (deferred) {
        // A Batch Debate's step failed. Its retry must ask the models again rather than replay the stored answers
        // that failed, and must keep counting attempts across the waits ahead.
        if (error instanceof BudgetExhaustedError || error instanceof BatchCallFailedError || attempt >= MAX_ATTEMPTS) {
          await failStep(deps, debateId, reason(error));
        } else {
          await deferred.forget();
          await env.STEP_QUEUE.send({ debateId, attempt: attempt + 1 }, { delaySeconds: RETRY_DELAY_SECONDS });
        }
        message.ack();
        continue;
      }
      if (!(error instanceof BudgetExhaustedError) && message.attempts < MAX_ATTEMPTS) {
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      } else {
        await failStep(deps, debateId, reason(error));
        message.ack();
      }
    }
  }
}
