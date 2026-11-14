# Batch Debates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can start a Batch Debate:
- generated entirely through OpenRouter's Batch API (about half price, minutes to hours);
- costing 1 Quota point instead of 2;
- labelled, published only once complete, with no Audience Votes and no live stream;
- decided by its Verdict and, if it has AI Voters, the AI Audience Result.

**Architecture:**
- **Same steps as a live Debate.** A Batch Debate runs the same state-driven queue steps. Each step runs the engine against a deferred `ModelClient`:
  - The first time the client sees a request, it submits a one-request batch to OpenRouter, records it in `batch_calls`, and throws `BatchPendingError`.
  - Later runs of the step poll that batch, and return its stored response once it is complete.
  - The consumer answers `BatchPendingError` by re-enqueueing the step with a growing delay. This uses no retry attempt.
- **Cost:** recorded once, when a batch call completes, from batch prices.
- **Offline dev:** with fake models, a fake Batch API answers after `FAKE_BATCH_DELAY_MS` (2 s), so `pnpm dev` and the tests run Batch Debates offline.
- **AI Voters:** opt-in AI Voters already exist since Plan 2. This plan only lets them run in batch.

**Tech Stack:** as before. OpenRouter Batch API: `POST /api/v1/batches` and `GET /api/v1/batches/{id}`, one model per batch, results inline once complete. There's no webhook yet; it needs a public URL and a signing secret, so it moves to Plan 7.

**Spec:** `GLOSSARY.md` (Batch Debate, Quota, AI Voter, AI Audience Result); roadmap row 6; ADR 0002, 0003, 0005; research notes in this plan.

## Global Constraints

- **Batch Debate rules (GLOSSARY):**
  - Only batch-capable models.
  - `BATCH_DEBATE_QUOTA_POINTS = 1` (a Debate costs 2).
  - Published only when complete.
  - Always labelled "Batch Debate".
  - No Premiere and no Audience Votes: votes are refused with 403 `Batch Debates take no Audience Votes`.
  - Its outcome is the Verdict, plus the AI Audience Result when it has AI Voters.
- **Batch-capable catalog entries.**
  - A batch-capable entry has a `batchPrice` taken from OpenRouter's `<id>:batch` entries, read live on 2026-11-14.
  - Batch calls submit the base id (no `:batch` suffix) with the same body as a live call, including `reasoning: { enabled: false }` where the entry's `reasoning` is `'optional'`.

  | Model | Batch price (USD per M tokens, in / out) | Roles |
  |---|---|---|
  | `anthropic/claude-haiku-5.5` | 0.05 / 0.25 | all |
  | `openai/gpt-6.1-terra` | 0.5 / 2.5 | all |
  | `deepseek/deepseek-v4.1-flash` | 0.112 / 0.336 | all; dearer than its normal price, still batch-capable |
  | `google/gemini-3.8-flash` | normal 0.825 / 4.125, batch 0.375 / 1.875 | new entry, all roles, reasoning `'optional'`; gives Batch Debates a third family for Judges and AI Voters |
- **While running, a Batch Debate is visible only to the Member who started it.**
  - `GET /api/debates/:id` returns 404 for everyone else.
  - The starting Member gets the view with `turns: []`, `kind: 'batch'` and `status: 'running'`.
  - `GET /live` returns 404 for a Batch Debate.
- **Motion screening stays a normal (synchronous) call**, because the screener (Llama Guard 4) has no batch variant. Screening is moderation, not Debate content.
- **The Budget** uses batch prices for every Debate, Judge and AI Voter call (still × `MAX_ATTEMPTS`), plus the normal screener price.
- **Polling:**
  - Steps waiting on a batch re-enqueue with delay `min(60 × 2^waits, 900)` seconds in production, or 2 s with fake models.
  - `waits` is carried in the `StepJob` (`{ debateId, waits?: number }`).
  - A batch that ends `failed`, `expired` or `cancelled` throws an ordinary error (an attempt is used). Its `batch_calls` row is deleted, so the retry submits again. After `MAX_ATTEMPTS` the Debate fails, as live ones do.
- **No new cookies, secrets or third parties.** The existing `OPENROUTER_API_KEY` covers the Batch API.
- **Tooling and attribution:** as before. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A step re-run while waiting:**
   - Each poll re-runs the engine from stored state. Already completed calls must return their stored responses without new spend or double-counted cost.
   - Calls still pending must not be resubmitted.
   - Owner: Task 3 `a completed call is charged once however often the step re-runs` and `a pending call is not resubmitted`.
2. **The engine repeating a request** (a retry after an unparseable reply, or two AI Voters with the same model):
   - Each occurrence within one step is its own batch call, keyed by request hash plus occurrence number.
   - Otherwise the retry would just get the same unparseable answer.
   - Owner: Task 3 `the same request twice in one step is two calls`.
3. **Pending is not failure:**
   - Waiting never uses a retry attempt and never fails or drops an AI Voter.
   - `runAiAudience` must let the pending signal through rather than drop the voter.
   - Owner: Task 2 (engine) and Task 4 `waiting does not use attempts`.
4. **Visibility while running:**
   - Other Viewers get 404, the feed shows nothing, and votes and live are refused.
   - The page for the starting Member says it is being generated.
   - Owner: Task 5 and Task 6 e2e.
5. **Mixing modes:**
   - A Batch Debate can't name a non-batch Debater or Judge (400).
   - Its suggested Panel and AI Voters come only from batch-capable models.
   - A live Debate is unchanged.
   - Owner: Task 1.

---

### Task 1: Catalog, start validation, Quota and Budget for Batch Debates

**Files:**
- Modify: `apps/api/src/models/catalog.ts`, `apps/api/src/debates/start.ts`, `apps/api/src/db/quota.ts` (constant), `apps/api/src/app.ts` (`/models`, the start input)
- Create: `apps/api/migrations/0005_batch_debates.sql`
- Modify: `apps/api/src/db/debates.ts` (`kind`)
- Test: `apps/api/test/{catalog,start}.test.ts`

**Interfaces:**
- Produces:
  - **Catalog:**
    - `CatalogEntry.batchPrice?: ModelPrice`.
    - `isBatchCapable(catalog, id)`.
    - `catalogFor(catalog, kind: 'live' | 'batch'): Catalog` filters to batch-capable entries and swaps `price` for `batchPrice` (the screener entry is kept with its normal price).
    - The fake catalog marks `fake-a/one`, `fake-b/one`, `fake-c/one` and `fake-d/one` batch-capable (`batchPrice: price(0.5, 0.5)`), but not `fake-slow/one` or `fake-a/debater-only`.
  - **`GET /api/models`:** each model gains `batch: boolean`.
  - **Migration `0005_batch_debates.sql`:** `ALTER TABLE debates ADD COLUMN kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live','batch'))`. `DebateRecord.kind` and `NewDebate.kind`.
  - **`StartDebateInput` gains `batch: boolean`** (optional, default false). A Batch Debate:
    - validates the Debaters, Panel and AI Voters against `catalogFor(catalog, 'batch')`;
    - costs `BATCH_DEBATE_QUOTA_POINTS = 1`;
    - computes the Budget with `priceTable(catalogFor(catalog, 'batch'))` plus the screener's normal price;
    - stores `kind: 'batch'`.

- [ ] **Step 1: Write the failing tests:**
  - `batch-capable models are marked and priced at their batch price`.
  - `a Batch Debate costs one Quota point` (6 points allow 6 Batch Debates; 2 Debates + 2 Batch Debates leaves 0).
  - `a Batch Debate refuses a model without batch` (400 `Model fake-slow/one has no batch processing`).
  - `a Batch Debate's Panel and AI Voters are batch-capable`.
  - `a Batch Debate reserves its Budget at batch prices`: it is lower than the same live Debate's.
  - `/api/models marks batch-capable models`.
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/api test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Batch Debates: batch-capable catalog, one Quota point, batch prices`.

### Task 2: Engine: let a pending call through `runAiAudience`

**Files:**
- Modify: `packages/engine/src/voting/ai-voter.ts` (+test)

**Interfaces:**
- Produces: `runAiAudience(setup, turns, voters, client, options?: { rethrow?: (error: unknown) => boolean })`.
  - All voters still run in parallel and settle.
  - Afterwards, if any rejection matches `rethrow`, the first such rejection is thrown instead of dropping voters.
  - Every voter's call has been made by then, so a batch round submits all of them at once.

- [ ] **Step 1: Write the failing tests:**
  - `a rethrown error is not a dropped voter`: a client that throws `Pending` for one model, with `rethrow: e => e instanceof Pending`, rejects with `Pending`, and every voter's first call was made.
  - Without `rethrow`, behaviour is unchanged (existing tests).
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/engine test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): runAiAudience can let a pending call through`.

### Task 3: API: Batch API client, fake Batch API, deferred model client

**Files:**
- Create:
  - `apps/api/src/models/batch.ts`: `BatchApi` interface, `OpenRouterBatchApi`, `FakeBatchApi`, `BatchPendingError`
  - `apps/api/src/models/deferred.ts`: `deferredClient`
  - `apps/api/migrations/0006_batch_calls.sql`
  - `apps/api/src/db/batch-calls.ts`
- Test: `apps/api/test/{batch,deferred}.test.ts`

**Schema `0006_batch_calls.sql`:**
- `batch_calls`:
  - `debate_id TEXT NOT NULL`, `call_key TEXT NOT NULL`, `model TEXT NOT NULL`, `batch_id TEXT NOT NULL`
  - `status TEXT NOT NULL CHECK (status IN ('pending','completed'))`
  - `response_json TEXT`, `created_at TEXT NOT NULL`, `completed_at TEXT`
  - `PRIMARY KEY (debate_id, call_key)`

**Interfaces:**
- Produces:
  - **`interface BatchApi`:**
    - `submit(request: ModelRequest): Promise<string>` returns the batch id.
    - `get(id: string): Promise<{ status: 'pending' } | { status: 'completed'; response: ModelResponse } | { status: 'failed'; reason: string }>`.
  - **`OpenRouterBatchApi(apiKey, { disableReasoning, fetch? })`:**
    - `submit` POSTs `/api/v1/batches` with `{ endpoint: '/v1/chat/completions', model, completion_window: '24h', requests: [{ custom_id: 'call', body: { model, messages, max_tokens, reasoning? } }] }` and returns `id`. A non-2xx response throws.
    - `get` GETs `/api/v1/batches/{id}`:
      - `validating`, `in_progress` or `finalizing` give pending.
      - `completed` with `results[0].response` gives completed. Text, token usage and finish reason are read as in `OpenRouterModelClient`; missing usage falls back to the worst case, as there.
      - `failed`, `expired`, `cancelled`, or `completed` with an error give failed.
  - **`FakeBatchApi(reply = devFakeReply, delayMs = FAKE_BATCH_DELAY_MS, now = Date.now)`:**
    - An in-memory map keyed by id is not durable across Worker requests. So the fake stores `{request, readyAt}` in `batch_calls.batch_id` as `fake:<readyAt>:<base64 request>`, and `get` decodes it. That makes it stateless.
    - `FAKE_BATCH_DELAY_MS = 2000`.
  - **`BatchPendingError extends Error`.**
  - **`deferredClient({ db, debateId, api, prices, onCost, guard }): ModelClient & { reset(): void }`.** `complete(request)` works like this:
    1. `key = sha256(JSON of { model, messages, maxOutputTokens }) + '#' + n`, where `n` counts earlier identical requests during this step run (`reset()` zeroes the counters at the start of each step).
    2. A completed row returns its stored response.
    3. A pending row is polled with `api.get`:
       - completed: store the response, and charge `onCost` exactly once (only the update that moves the row from `pending` to `completed` charges), then return it;
       - failed: delete the row and throw `Error('Batch call failed: …')`;
       - pending: throw `BatchPendingError`.
    4. With no row, it runs `guard()` (the Budget), calls `api.submit`, inserts a pending row (`ON CONFLICT DO NOTHING`), and throws `BatchPendingError`.

- [ ] **Step 1: Write the failing tests:**
  - `OpenRouterBatchApi submits one request with the base model id`: a fake fetch checks the URL, the body shape and the auth header.
  - `OpenRouterBatchApi reads a completed batch`, `… reports a failed batch`, `… keeps waiting while in progress`.
  - `FakeBatchApi answers after its delay`.
  - `a pending call is not resubmitted`.
  - `a completed call is charged once however often the step re-runs`.
  - `the same request twice in one step is two calls`.
  - `a failed batch call is resubmitted on the next attempt`.
  - `the Budget guard stops new submissions`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): OpenRouter Batch API client and a deferred model client`.

### Task 4: API: steps and consumer run Batch Debates

**Files:**
- Modify: `apps/api/src/debates/{steps,consumer,start}.ts`
- Test: `apps/api/test/{steps,consumer}.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - **`StepJob = { debateId: string; waits?: number }`.**
  - **Consumer:**
    - A Batch Debate's step uses `deferredClient` for Debate, Judge and AI Voter calls. The API is `OpenRouterBatchApi` or `FakeBatchApi` by `MODEL_PROVIDER`, with prices from `catalogFor(catalog, 'batch')` and the existing Budget guard.
    - Screening keeps the normal metered client.
    - `notify` is a no-op: there are no live events for Batch Debates.
    - `runAiAudience` gets `rethrow: e => e instanceof BatchPendingError`.
  - **On `BatchPendingError`:** ack and send `{ debateId, waits: waits + 1 }` with delay `pollDelaySeconds(waits, provider)`: 2 s with fake models, otherwise `min(60 × 2^waits, 900)`.
  - **Other errors:** keep the existing retry and fail behaviour.
  - **`StepDeps` gains `client` per step**, chosen by the consumer from `debate.kind`. `runStep` stays the same apart from passing `rethrow` into `runAiAudience`.

- [ ] **Step 1: Write the failing tests:**
  - `a Batch Debate completes through batch calls`: drive the consumer with `FakeBatchApi` (delay 0) until complete. Expect 6 Turns, a Verdict and an AI Audience Result, cost recorded at batch prices, and no broadcasts.
  - `waiting does not use attempts`: a pending step is acked and re-sent with `waits + 1` and a delay, the Debate is still running, and there's no retry.
  - `a Batch Debate whose batch call keeps failing fails after MAX_ATTEMPTS`.
  - `a live Debate still uses normal calls`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Batch Debates run through batch calls and wait without spending attempts`.

### Task 5: API: what Viewers see of a Batch Debate

**Files:**
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/batch-visibility.test.ts`

**Interfaces:**
- Produces:
  - The views (`PublicDebate`, `DebateSummary`) gain `kind: 'live' | 'batch'`.
  - A running Batch Debate returns 404 to everyone but its starting Member.
  - Votes on a Batch Debate return 403 `Batch Debates take no Audience Votes`.
  - Live on a Batch Debate returns 404.
  - Reports work as usual.

- [ ] **Step 1: Write the failing tests:**
  - `a running Batch Debate is hidden from other Viewers`.
  - `its starting Member sees it is being generated`.
  - `a complete Batch Debate is public and labelled batch`.
  - `Batch Debates take no Audience Votes`.
  - `a Batch Debate has no live stream`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Batch Debates are private until complete and take no votes`.

### Task 6: Web: start a Batch Debate; labels; pages

**Files:**
- Modify: `apps/web/src/islands/StartDebateForm.svelte`, `apps/web/src/pages/{index,new}.astro`, `apps/web/src/pages/debates/[id].astro`, `apps/web/src/i18n/en.ts`
- Create: `apps/web/src/components/BatchBadge.astro`
- Test: `apps/web/test/start-debate-form.test.ts`, `apps/web/e2e/batch.spec.ts`

**Interfaces:**
- Produces:
  - **Start form:** a "Batch Debate" checkbox, with a hint: cheaper, ready in minutes to hours, published when complete, no Audience Votes.
    - When checked, the Debater and Judge selects list only `batch` models, and the cost line shows 1 point.
    - It's disabled only when `quotaRemaining < 1`.
    - The post body gains `batch: true`.
  - **Feed and Debate page:** `BatchBadge` ("Batch Debate", with a visually hidden explanation) shows on Batch Debates.
  - **Debate page for a Batch Debate:** no VotePanel and no LiveTurns.
    - While running, which only its starter can see, it shows `t('batch.generating')`, saying it will be published when complete and the page can be reloaded later.

- [ ] **Step 1: Write the failing tests:**
  - **Component:**
    - `a Batch Debate lists only batch-capable models and costs one point`;
    - `posts batch: true`;
    - `one Quota point is enough for a Batch Debate`.
  - **e2e:**
    - `start a Batch Debate, see it is being generated, then read it when complete` (fake batch delay 2 s, so it completes in about 30 s);
    - `another Viewer cannot see a running Batch Debate` (404);
    - axe on the generating page and on a complete Batch Debate.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, build and e2e. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): start and read Batch Debates`.

### Task 7: Docs and gates

**Files:**
- Modify: `README.md` (Batch Debates; local timing with fake batches), `docs/superpowers/plans/2026-11-13-roadmap.md` (link Plan 6; the batch webhook moves to Plan 7)

- [ ] **Step 1: Run** `pnpm check`, then the web build, e2e and lighthouse. Expected: all PASS.
- [ ] **Step 2: Commit** `docs: Batch Debates in the README and roadmap`.
