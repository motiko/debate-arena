import { MAX_ATTEMPTS } from '@debate-arena/engine';
import { addCost } from '../db/debates';
import type { DebateEvent } from '../live/events';
import { priceTable } from '../models/catalog';
import { createModels, meteredClient } from '../models/factory';
import type { StepJob } from './start';
import { failStep, runStep, type StepDeps } from './steps';

const RETRY_DELAY_SECONDS = 5;

/** Live updates are best-effort: Viewers can always reload state over HTTP. Replaced by DebateRoom in Task 8. */
async function notifyViewers(_env: Env, _debateId: string, _event: DebateEvent): Promise<void> {}

/** Queue handler: runs one Debate step per message; retries once, then fails the Debate and refunds its Quota. */
export async function consumer(batch: MessageBatch<StepJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
  const models = createModels(env as Env & { OPENROUTER_API_KEY?: string });
  const prices = priceTable(models.catalog);

  for (const message of batch.messages) {
    const { debateId } = message.body;
    const deps: StepDeps = {
      db: env.DB,
      client: meteredClient(models.client, prices, cost => addCost(env.DB, debateId, cost)),
      notify: (id, event) => notifyViewers(env, id, event),
      enqueue: async job => {
        await env.STEP_QUEUE.send(job);
      },
      now: () => new Date(),
    };
    try {
      await runStep(deps, message.body);
      message.ack();
    } catch (error) {
      if (message.attempts < MAX_ATTEMPTS) {
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      } else {
        await failStep(deps, debateId, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        message.ack();
      }
    }
  }
}
