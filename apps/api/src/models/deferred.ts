import { MAX_ATTEMPTS, type ModelClient, type ModelRequest, type ModelResponse, type PriceTable } from '@debate-arena/engine';
import { BatchCallFailedError, BatchPendingError, type BatchApi, type BatchStatus } from './batch';
import { OpenRouterError } from './openrouter';

export interface DeferredDeps {
  db: D1Database;
  debateId: string;
  api: BatchApi;
  /** Batch prices, in USD per million tokens. */
  prices: PriceTable;
  /** Records a call's cost in micro-USD; called once per batch result (completed, or failed after spending). */
  onCost: (microUsd: number) => Promise<void>;
  /** Runs before each new submission and throws to stop spending (the Budget). */
  guard: () => Promise<void>;
}

type CallStatus = 'submitting' | 'pending' | 'completed' | 'failed';

interface CallRow {
  batch_id: string | null;
  status: CallStatus;
  failures: number;
  response_json: string | null;
  updated_at: string;
}

/** A claim to submit that is older than this was left by a run that died; another run may take it over. */
const STALE_CLAIM_MS = 5 * 60_000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Errors worth waiting out: OpenRouter overloaded or down, or the network. Anything else is a real failure. */
function isTransient(error: unknown): boolean {
  if (error instanceof OpenRouterError) return error.status === null || error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

/**
 * A ModelClient for Batch Debates. The engine runs as usual; each call it makes is sent as a one-request batch,
 * and `complete` throws BatchPendingError until the result is in. A step re-run later finds its calls by key (the
 * request's hash plus how often the same request came earlier in this run, so an engine retry is a new call),
 * returns completed ones without spending again, and only waits on the rest.
 *
 * Only one run submits a call: it first claims the key. A failed batch is submitted again on a later run, until it
 * has failed MAX_ATTEMPTS times; then BatchCallFailedError fails the Debate.
 */
export function deferredClient(deps: DeferredDeps): ModelClient & { forget(): Promise<void> } {
  const { db, debateId, api } = deps;
  const seen = new Map<string, number>();
  const returned: string[] = [];
  const now = () => new Date().toISOString();

  const charge = async (model: string, tokens: { inputTokens: number; outputTokens: number }) => {
    const price = Object.hasOwn(deps.prices, model) ? deps.prices[model] : undefined;
    if (price) await deps.onCost(Math.ceil(tokens.inputTokens * price.inputPerMTokUsd + tokens.outputTokens * price.outputPerMTokUsd));
  };

  const row = (key: string) =>
    db
      .prepare('SELECT batch_id, status, failures, response_json, updated_at FROM batch_calls WHERE debate_id = ? AND call_key = ?')
      .bind(debateId, key)
      .first<CallRow>();

  /** Takes the right to submit this call; false when another run holds it (or has already submitted it). */
  async function claim(key: string, request: ModelRequest, current: CallRow | null): Promise<boolean> {
    const at = now();
    if (!current) {
      const inserted = await db
        .prepare(
          `INSERT INTO batch_calls (debate_id, call_key, model, status, created_at, updated_at) VALUES (?, ?, ?, 'submitting', ?, ?)
           ON CONFLICT (debate_id, call_key) DO NOTHING`,
        )
        .bind(debateId, key, request.model, at, at)
        .run();
      return inserted.meta.changes === 1;
    }
    const stale = current.status === 'submitting' && Date.parse(current.updated_at) < Date.now() - STALE_CLAIM_MS;
    if (current.status !== 'failed' && !stale) return false;
    const taken = await db
      .prepare(`UPDATE batch_calls SET status = 'submitting', updated_at = ? WHERE debate_id = ? AND call_key = ? AND status = ? AND updated_at = ?`)
      .bind(at, debateId, key, current.status, current.updated_at)
      .run();
    return taken.meta.changes === 1;
  }

  async function submit(key: string, request: ModelRequest): Promise<never> {
    try {
      await deps.guard();
      const batchId = await api.submit(request);
      await db
        .prepare(`UPDATE batch_calls SET batch_id = ?, status = 'pending', updated_at = ? WHERE debate_id = ? AND call_key = ?`)
        .bind(batchId, now(), debateId, key)
        .run();
    } catch (error) {
      // Give the claim back (as 'failed', without counting a failure), so a later run can try again, or the Debate
      // fails on this error.
      await db
        .prepare(`UPDATE batch_calls SET status = 'failed', updated_at = ? WHERE debate_id = ? AND call_key = ? AND status = 'submitting'`)
        .bind(now(), debateId, key)
        .run();
      throw error;
    }
    throw new BatchPendingError(`Submitted ${request.model}`);
  }

  return {
    /** Discards the calls this run returned, so a retried step asks the models again instead of replaying them. */
    async forget() {
      for (const key of returned) {
        await db.prepare(`DELETE FROM batch_calls WHERE debate_id = ? AND call_key = ? AND status = 'completed'`).bind(debateId, key).run();
      }
      returned.length = 0;
    },

    async complete(request) {
      const hash = await sha256(JSON.stringify({ model: request.model, messages: request.messages, maxOutputTokens: request.maxOutputTokens }));
      const occurrence = seen.get(hash) ?? 0;
      seen.set(hash, occurrence + 1);
      const key = `${hash}#${occurrence}`;

      const current = await row(key);

      if (current?.status === 'completed' && current.response_json) {
        returned.push(key);
        return JSON.parse(current.response_json) as ModelResponse;
      }

      if (current?.status === 'pending' && current.batch_id) {
        let result: BatchStatus;
        try {
          result = await api.get(current.batch_id, request);
        } catch (error) {
          if (isTransient(error)) throw new BatchPendingError(`Could not check ${request.model} yet`);
          throw error;
        }
        if (result.status === 'pending') throw new BatchPendingError(`Waiting for ${request.model}`);
        if (result.status === 'completed') {
          const stored = await db
            .prepare(
              `UPDATE batch_calls SET status = 'completed', response_json = ?, completed_at = ?, updated_at = ?
               WHERE debate_id = ? AND call_key = ? AND status = 'pending'`,
            )
            .bind(JSON.stringify(result.response), now(), now(), debateId, key)
            .run();
          // Only the run that completes the call charges for it.
          if (stored.meta.changes === 1) await charge(request.model, result.response);
          returned.push(key);
          return result.response;
        }
        const failed = await db
          .prepare(
            `UPDATE batch_calls SET status = 'failed', failures = failures + 1, updated_at = ?
             WHERE debate_id = ? AND call_key = ? AND status = 'pending'`,
          )
          .bind(now(), debateId, key)
          .run();
        if (failed.meta.changes === 1 && result.usage) await charge(request.model, result.usage);
        if (current.failures + 1 >= MAX_ATTEMPTS) throw new BatchCallFailedError(`Batch call to ${request.model} failed: ${result.reason}`);
        throw new BatchPendingError(`Batch call to ${request.model} failed (${result.reason}); it will be submitted again`);
      }

      if (current?.status === 'failed' && current.failures >= MAX_ATTEMPTS) {
        throw new BatchCallFailedError(`Batch call to ${request.model} failed ${current.failures} times`);
      }

      if (await claim(key, request, current)) return submit(key, request);
      throw new BatchPendingError(`Another run is submitting ${request.model}`);
    },
  };
}
