import type { ModelClient, ModelRequest, ModelResponse, PriceTable } from '@debate-arena/engine';
import { BatchPendingError, type BatchApi } from './batch';

export interface DeferredDeps {
  db: D1Database;
  debateId: string;
  api: BatchApi;
  /** Batch prices, in USD per million tokens. */
  prices: PriceTable;
  /** Records a completed call's cost in micro-USD; called once per call. */
  onCost: (microUsd: number) => Promise<void>;
  /** Runs before each new submission and throws to stop spending (the Budget). */
  guard: () => Promise<void>;
}

interface CallRow {
  batch_id: string;
  status: 'pending' | 'completed';
  response_json: string | null;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A ModelClient for Batch Debates. The engine runs as usual; each call it makes is sent as a one-request batch,
 * and `complete` throws BatchPendingError until the result is in. A step re-run later finds its calls by key (the
 * request's hash plus how often the same request came earlier in this run, so an engine retry is a new call),
 * returns completed ones without spending again, and only waits on the rest. `reset()` starts a new run.
 */
export function deferredClient(deps: DeferredDeps): ModelClient & { reset(): void } {
  const { db, debateId, api } = deps;
  let seen = new Map<string, number>();

  const charge = async (request: ModelRequest, response: ModelResponse) => {
    const price = Object.hasOwn(deps.prices, request.model) ? deps.prices[request.model] : undefined;
    if (price) await deps.onCost(Math.ceil(response.inputTokens * price.inputPerMTokUsd + response.outputTokens * price.outputPerMTokUsd));
  };

  return {
    reset() {
      seen = new Map();
    },

    async complete(request) {
      const hash = await sha256(JSON.stringify({ model: request.model, messages: request.messages, maxOutputTokens: request.maxOutputTokens }));
      const occurrence = seen.get(hash) ?? 0;
      seen.set(hash, occurrence + 1);
      const key = `${hash}#${occurrence}`;

      const row = await db
        .prepare('SELECT batch_id, status, response_json FROM batch_calls WHERE debate_id = ? AND call_key = ?')
        .bind(debateId, key)
        .first<CallRow>();

      if (row?.status === 'completed' && row.response_json) return JSON.parse(row.response_json) as ModelResponse;

      if (row) {
        const result = await api.get(row.batch_id, request);
        if (result.status === 'pending') throw new BatchPendingError(`Waiting for batch ${row.batch_id}`);
        if (result.status === 'failed') {
          // Forget the call, so the step's next attempt submits it again.
          await db.prepare('DELETE FROM batch_calls WHERE debate_id = ? AND call_key = ?').bind(debateId, key).run();
          throw new Error(`Batch call failed: ${result.reason}`);
        }
        const stored = await db
          .prepare(
            `UPDATE batch_calls SET status = 'completed', response_json = ?, completed_at = ?
             WHERE debate_id = ? AND call_key = ? AND status = 'pending'`,
          )
          .bind(JSON.stringify(result.response), new Date().toISOString(), debateId, key)
          .run();
        // Only the run that completes the call charges for it.
        if (stored.meta.changes === 1) await charge(request, result.response);
        return result.response;
      }

      await deps.guard();
      const batchId = await api.submit(request);
      await db
        .prepare(
          `INSERT INTO batch_calls (debate_id, call_key, model, batch_id, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)
           ON CONFLICT (debate_id, call_key) DO NOTHING`,
        )
        .bind(debateId, key, request.model, batchId, new Date().toISOString())
        .run();
      throw new BatchPendingError(`Submitted batch ${batchId}`);
    },
  };
}
