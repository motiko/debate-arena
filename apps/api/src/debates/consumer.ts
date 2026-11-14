import { MAX_ATTEMPTS } from '@debate-arena/engine';
import { addCost, getBudget } from '../db/debates';
import type { DebateEvent } from '../live/events';
import { priceTable, screenerFor } from '../models/catalog';
import { BudgetExhaustedError, createModels, meteredClient } from '../models/factory';
import type { StepJob } from './start';
import { failStep, runStep, type StepDeps } from './steps';

const RETRY_DELAY_SECONDS = 5;

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
 * Queue handler: runs one Debate step per message. A failing step is retried once, then the Debate fails;
 * a Debate that has used up its Budget fails at once.
 */
export async function consumer(batch: MessageBatch<StepJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
  const models = createModels(env as Env & { OPENROUTER_API_KEY?: string });
  const prices = priceTable(models.catalog);

  for (const message of batch.messages) {
    const { debateId } = message.body;
    // Enforce the reserved Budget where money is spent: no new model call once spending has reached it.
    // A call already in flight can overshoot by at most that one call.
    const budgetGuard = async () => {
      const budget = await getBudget(env.DB, debateId);
      if (budget && budget.spentMicroUsd >= budget.reservedMicroUsd) {
        throw new BudgetExhaustedError(`Spent ${budget.spentMicroUsd} of ${budget.reservedMicroUsd} micro-USD`);
      }
    };
    const deps: StepDeps = {
      db: env.DB,
      client: meteredClient(models.client, prices, cost => addCost(env.DB, debateId, cost), budgetGuard),
      notify: (id, event) => notifyViewers(env, id, event),
      enqueue: async job => {
        await env.STEP_QUEUE.send(job);
      },
      now: () => new Date(),
      screener: screenerFor(models.catalog),
    };
    try {
      await runStep(deps, message.body);
      message.ack();
    } catch (error) {
      if (!(error instanceof BudgetExhaustedError) && message.attempts < MAX_ATTEMPTS) {
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      } else {
        await failStep(deps, debateId, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        message.ack();
      }
    }
  }
}
