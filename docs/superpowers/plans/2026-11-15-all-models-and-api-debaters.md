# All OpenRouter Models and API Debaters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can seat any usable OpenRouter model, free ones included (found with a search box), as a Debater or Judge, or give a bench to an API Debater whose Turns arrive, optionally streamed, through `POST /api/debates/:id/turns/:slot`; a Debate's Quota cost follows its worst-case Budget, and Slow Debate is offered only for batch-capable line-ups.

**Architecture:** The API Worker builds its catalog from OpenRouter's public models list (cached one hour in D1 and in isolate memory, curated entries layered on top, curated-only fallback) and freezes each Debate's model prices at start in a new `models_json` column. The engine gains a Debater kind `api`; a step that reaches an API slot records a deadline, broadcasts `awaiting` and queues a deadline check instead of generating. A token-only route reads the streamed `text/plain` body, relays drafts through the existing `createDraftSender`, stores the Turn with the same cutting rules as an AI Turn, screens it, and enqueues the next step. The web form replaces `<select>`s with a searchable combobox island; the CLI gains `--for api`, `debate speak` and `models --search`.

**Tech Stack:** TypeScript, Cloudflare Workers (Hono, D1, Queues, Durable Objects), OpenRouter, Astro + Svelte 5, Vitest (+ `@cloudflare/vitest-pool-workers`), Playwright, Node ≥ 24 CLI.

**Spec:** `docs/superpowers/specs/2026-11-15-all-models-and-api-debaters-design.md`

## Global Constraints

- Constants, verbatim: `REASONING_ALLOWANCE_TOKENS = 2048`, `MAX_DEBATE_BUDGET_MICRO_USD = 5_000_000`, `QUOTA_POINT_MICRO_USD = 12_500`, `DAILY_QUOTA_POINTS = 24`, `API_TURN_TIMEOUT_SECONDS = 600`, `MAX_API_TURN_BYTES = 65_536`, `CATALOG_TTL_SECONDS = 3600`, `CATALOG_FETCH_TIMEOUT_MS = 3000`, `MIN_CONTEXT_TOKENS = 16_000`, `PICKER_MAX_OPTIONS = 50`.
- The reserved Debater value in `POST /api/debates` is the string `"api"`; the stored Debater is `{ kind: 'api' }`.
- New live event, verbatim: `{ type: 'awaiting'; slotIndex: number; deadline: string }` (ISO-8601 UTC).
- The Turn route accepts only API tokens (never a session cookie, never `x-dev-member` outside `DEV_AUTH=true`).
- API Turns get the same cutting rules as AI Turns (`truncateToWords` then `trimToLastSentence` when cut).
- Drafts from API Turns follow the streaming-turns rules unchanged (`createDraftSender`, 300 ms, `MAX_DRAFTS_PER_TURN`).
- Curated entries alone are AI Voters, the screener and the suggested-Judge candidates.
- Copy (en.ts), verbatim: `'label.api': 'Submitted via API'`, `'debater.api': 'API Debater'`, `'new.api': 'API — submit this side’s Turns yourself'`, `'new.apiHint': 'Send each Turn with your API token, e.g. debate speak <id>. You have 10 minutes per Turn.'`, `'new.search': 'Search {count} models'`, `'new.moreMatches': 'Type to narrow down {count} more models'`, `'new.noMatches': 'No model matches “{query}”'`, `'new.price': '${input} / ${output} per M tokens'`, `'floor.awaiting': '{side} is preparing a Turn via the API'`.
- Quota points for a Debate: `max(1, ceil(budgetMicroUsd / QUOTA_POINT_MICRO_USD))`, 0 for unlimited-Quota Members. `DEBATE_QUOTA_POINTS` and `BATCH_DEBATE_QUOTA_POINTS` are removed everywhere.
- Batch-capable: has `batchPrice` and reasoning is not `'mandatory'`.
- More copy (en.ts), verbatim: `'new.cost': '{points} Quota points · you have {left} left today'`, `'new.costOne': '1 Quota point · you have {left} left today'`, `'new.slowUnavailable': 'Slow Debate is not available for {model}'`.
- Error copy, verbatim: `'This line-up needs {points} Quota points; a day has 24. Choose cheaper models or leave out AI Voters.'`, `'This line-up could cost up to ${cost}; a Debate may reserve at most $5.00.'`, `'A Slow Debate cannot have an API Debater'`, `'This Debate is not waiting for Turn {slot}'`.
- No new runtime dependencies. No `{@html}`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; no "Generated with Claude Code" line in the PR.

## Review Focus

- OpenRouter's list is slow, down, or returns HTML/garbage: `/new` and `POST /debates` must still work on the cached or curated catalog within ~3 s — test in Task 2 (`loadCatalog`).
- A model disappears from OpenRouter's list (or changes price) mid-Debate: its calls must still be metered at the start price — test in Task 3 (consumer uses `models_json`).
- A streamed Turn whose client disconnects halfway: nothing stored, draft cleared, slot still open — test in Task 5.
- A multi-byte body split across chunks (UTF-8 boundary) and a body that crosses 64 KiB mid-stream — test in Task 5.
- A Turn posted for the right slot after the deadline job already failed the Debate, or a deadline job that runs after the Turn arrived — both must leave the Debate consistent — tests in Task 4 (late deadline job) and Task 5 (late Turn).

---

### Task 0: Spike — does Cloudflare stream a request body to the Worker?

Needs the user's go-ahead: it deploys a throwaway Worker to their Cloudflare account, then deletes it.

**Files:** `$CLAUDE_JOB_DIR/tmp/stream-probe/` only (not committed).

- [ ] **Step 1:** Write a Worker `debate-arena-stream-probe` whose `fetch` reads `request.body` with a reader and answers with an NDJSON log of `{ ms: Date.now() - start, bytes }` per chunk.
- [ ] **Step 2:** `npx wrangler deploy` it (workers.dev), then send a body from Node 24 in 6 chunks one second apart: `fetch(url, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'text/plain' } })`. Also try `curl -T - ` from a slow pipe (`(for i in 1 2 3 4 5 6; do echo chunk$i; sleep 1; done) | curl -sT - -H 'content-type: text/plain' $URL`).
- [ ] **Step 3:** Expected for "streams": chunk timestamps spread over ~5 s. Expected for "buffers": all chunks within a few ms after ~5 s.
- [ ] **Step 4:** `npx wrangler delete debate-arena-stream-probe`. Record the result in the spec's "To be verified first" bullet (replace it with the finding and the date). If it buffers, Task 5 also adds the draft `PUT` route and Task 6's `speak` sends drafts with it (both spelled out in those tasks as "if Task 0 found buffering").
- [ ] **Step 5: Commit** the spec change — `docs: request-body streaming on Workers, verified`

### Task 1: Engine — API Debaters and reasoning allowance in the Budget

**Files:**
- Modify: `packages/engine/src/domain.ts`, `packages/engine/src/budget/estimate.ts`, `packages/engine/src/debate/generate-turn.ts`, `packages/engine/src/errors.ts`, `packages/engine/src/index.ts`, `GLOSSARY.md`
- Test: `packages/engine/src/budget/estimate.test.ts`, `packages/engine/src/debate/generate-turn.test.ts`

**Interfaces:**
- Produces:
  - `type Debater = { kind: 'ai'; model: ModelId } | { kind: 'human'; memberId: string } | { kind: 'api' }`
  - `interface ModelPrice { inputPerMTokUsd: number; outputPerMTokUsd: number; extraOutputTokens?: number }` — `extraOutputTokens` is added to every call's output in the worst case (the reasoning allowance).
  - `worstCaseBudgetMicroUsd(setup, aiVoters, prices, screener?)` additionally reserves one screen (`SCREEN_OUTPUT_TOKENS`, input = base + that Turn's output cap) per API slot when `screener` is given.
  - `class ApiTurnError extends EngineError` — thrown by `generateTurn` for an `api` slot (replaces `HumanTurnNotSupportedError` for that kind; keep the human error).
  - `isApiSlot(setup: DebateSetup, slot: TurnSlot): boolean`
  - `QUOTA_POINT_MICRO_USD = 12_500` and `quotaPointsFor(budgetMicroUsd: number): number` in `budget/estimate.ts` (exported from the index), shared by API and web.

- [ ] **Step 1: Write the failing tests**

```ts
test('an API Debater costs nothing but one screen per Turn', () => {
  const setup = { ...sample, debaters: { for: { kind: 'api' as const }, against: sample.debaters.against } };
  const withApi = worstCaseBudgetMicroUsd(setup, [], prices, 'guard/one');
  const allAi = worstCaseBudgetMicroUsd(sample, [], prices, 'guard/one');
  expect(withApi).toBeLessThan(allAi);
  // Hand-computed in the test from the fixture prices: the Against Turns, the Judge, the Motion screen and three Turn screens.
  expect(withApi).toBe(expectedWithApi);
});

test('extraOutputTokens is charged on every call of that model', () => {
  const plain = worstCaseBudgetMicroUsd(sample, [], prices);
  const reasoning = worstCaseBudgetMicroUsd(sample, [], { ...prices, [judge]: { ...prices[judge]!, extraOutputTokens: 2048 } });
  expect(reasoning - plain).toBe(Math.ceil(MAX_ATTEMPTS * 2048 * prices[judge]!.outputPerMTokUsd));
});

test('quotaPointsFor: one point per 1.25 cents, rounded up, at least 1', () => {
  expect(quotaPointsFor(0)).toBe(1);
  expect(quotaPointsFor(12_500)).toBe(1);
  expect(quotaPointsFor(12_501)).toBe(2);
  expect(quotaPointsFor(300_000)).toBe(24);
});

test('generateTurn refuses an API slot', async () => {
  await expect(generateTurn(apiForSetup, [], new FakeModelClient())).rejects.toBeInstanceOf(ApiTurnError);
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/engine test`
- [ ] **Step 3: Implement** the interfaces above. Add to `GLOSSARY.md` under Running a Debate, after **Debater**:
  Replace the **Quota** definition with: `How many Quota points a Member may spend per day on starting Debates. A Debate costs points in proportion to its worst-case Budget, so free models and Slow Debates cost less and expensive models, Judges or AI Voters more.` Also add `**API Debater**: A Debater whose Turns the starting Member submits through the platform API, written by hand or by their own program, instead of a platform model generating them. Its Turns are labelled as submitted via API, never as AI-generated. _Avoid_: Human Debater, external bot, BYO model`
- [ ] **Step 4: Run, expect PASS** — engine `test` and `typecheck`, then `pnpm typecheck` (the union change must not break api/web/cli; fix exhaustiveness errors by treating `api` like a non-AI Debater).
- [ ] **Step 5: Commit** — `feat(engine): API Debaters, Quota points from the Budget, a reasoning allowance`

### Task 2: API — live catalog from OpenRouter

**Files:**
- Create: `apps/api/migrations/0008_model_catalog.sql`, `apps/api/src/models/live-catalog.ts`, `apps/api/test/live-catalog.test.ts`, `apps/api/test/fixtures/openrouter-models.json` (≈12 trimmed real entries: an optional-reasoning model, a mandatory one, an unsupported one, a `:free` variant, a `:nitro` variant, a `:batch` variant of the optional-reasoning model and one of the mandatory model, `openrouter/auto` with −1 prices, an image-output model, one with `context_length` 8191, one missing `max_tokens`)
- Modify: `apps/api/src/models/catalog.ts`, `apps/api/src/models/factory.ts`, `apps/api/src/models/openrouter.ts`, `apps/api/src/app.ts` (`GET /models`, `POST /debates` call sites), `apps/api/src/debates/consumer.ts` (call site only)
- Test: `apps/api/test/catalog.test.ts`, `apps/api/test/factory.test.ts`, `apps/api/test/openrouter.test.ts`, `apps/api/test/routes.test.ts`

**Interfaces:**
- Produces:
  - `type ReasoningSupport = 'optional' | 'unsupported' | 'mandatory'`
  - `CatalogEntry` gains `contextLength?: number`, `curated?: true` (set on PRODUCTION_CATALOG entries) and `leastEffort?: string` (for `'mandatory'`: last entry of `reasoning.supported_efforts`, when given).
  - Migration `0008_model_catalog.sql`: `CREATE TABLE model_catalog (id INTEGER PRIMARY KEY CHECK (id = 1), catalog_json TEXT NOT NULL, fetched_at TEXT NOT NULL);`
  - `parseOpenRouterModels(body: unknown, curated: Catalog): Catalog` — applies the spec's filters, maps prices to per-million, folds `<id>:batch` into the base entry's `batchPrice`, maps reasoning, keeps `:free` variants as their own entries labelled `"{name} (free)"` at price 0, gives every kept model `roles: ['debater', 'judge']`; a curated id keeps its curated label/reasoning/roles (and gains a live `batchPrice` only if curated had none); curated entries absent from the list are kept. Order: curated first in curated order, then the rest by label. Throws on a body without a `data` array.
  - `loadModels(env: ModelEnv & { DB: D1Database }, deps?: { fetcher?: typeof fetch; now?: () => number }): Promise<Models>` — replaces `createModels` at every call site (fake provider: unchanged `FAKE_CATALOG`, no fetch, no D1). Order: module-scope memo younger than `CATALOG_TTL_SECONDS` → `model_catalog` row younger than that → fetch `https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=max_tokens` with the key, aborted after `CATALOG_FETCH_TIMEOUT_MS`, parsed, upserted, memoized. On fetch/parse failure: the row however old, else `PRODUCTION_CATALOG` (neither is written back, so the next request tries again). Not the Cache API: it is a no-op on workers.dev.
  - `OpenRouterModelClient` option `reasoning?: (model: ModelId) => { support: ReasoningSupport; leastEffort?: string }` replaces `disableReasoning`: `'optional'` → `reasoning: { enabled: false }`; `'mandatory'` → `reasoning: { effort: entry.leastEffort ?? 'low' }` and `max_tokens: request.maxOutputTokens + REASONING_ALLOWANCE_TOKENS`.
  - `priceTable(catalog)` sets `extraOutputTokens: REASONING_ALLOWANCE_TOKENS` for mandatory-reasoning entries.
  - `GET /api/models` → `{ models: { id, label, roles, batch, inputPerMTokUsd, outputPerMTokUsd, contextLength }[] }`.

- [ ] **Step 1: Write the failing tests** — `parseOpenRouterModels`: keeps exactly the expected ids from the fixture; `:batch` price lands as `batchPrice`; a `:free` entry is kept with label suffix ` (free)` and zero prices; `openrouter/auto`, `:nitro`, image-output, 8191-context and no-`max_tokens` entries are dropped; mandatory → `'mandatory'`; `isBatchCapable` is true for the optional model with a `:batch` price and false for the mandatory one that has one; a curated id keeps label `'Claude Haiku 5.5'` and roles incl. `'voter'`. `loadModels`: (a) serves from cache without fetching on a second call; (b) a fetcher that rejects with no row → curated catalog; (c) a fetcher that never resolves → returns within ~3 s with the stale row (use fake timers); (d) a fetcher returning `<html>` → stale row, and the row is not overwritten; (e) a row older than an hour triggers a fetch and is replaced. `OpenRouterModelClient` with a mandatory model sends `max_tokens` = cap + 2048 and `reasoning.effort`. Route: `GET /api/models` entries carry `inputPerMTokUsd`.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/api test -- live-catalog catalog factory openrouter routes`
- [ ] **Step 3: Implement** the interfaces. `isBatchCapable` and `catalogFor(…, 'batch')` exclude `'mandatory'` entries. `createBatchApi` reads the same reasoning function. Add to `DEPLOY.md`: enable "free endpoints that may train on inputs" in the OpenRouter account's privacy settings, or free models fail.
- [ ] **Step 4: Run, expect PASS** — api `test`, `typecheck`.
- [ ] **Step 5: Commit** — `feat(api): catalog of every usable OpenRouter model, cached, curated entries on top`

### Task 3: API — prices frozen per Debate, Quota from the Budget, quotes, API seats on start

**Files:**
- Create: `apps/api/migrations/0009_debate_models.sql`
- Modify: `apps/api/src/debates/start.ts`, `apps/api/src/db/debates.ts`, `apps/api/src/db/quota.ts`, `apps/api/src/debates/consumer.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/start.test.ts`, `apps/api/test/consumer.test.ts`, `apps/api/test/db-debates.test.ts`, `apps/api/test/quota.test.ts`, `apps/api/test/routes.test.ts`, `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 `Debater`, `ModelPrice.extraOutputTokens`; Task 2 `Catalog`, `ReasoningSupport`, `priceTable`.
- Produces:
  - Migration 0009: `ALTER TABLE debates ADD COLUMN models_json TEXT;` and `ALTER TABLE debates ADD COLUMN turn_deadline TEXT;`
  - `type ModelSnapshot = Record<ModelId, { price: ModelPrice; reasoning: ReasoningSupport; leastEffort?: string }>`; `DebateRecord.models: ModelSnapshot | null`, `DebateRecord.turnDeadline: string | null`; `NewDebate` takes `models`.
  - `StartDebateInput.debaters: { for: ModelId | 'api'; against: ModelId | 'api' }`.
  - `planDebate(deps: Pick<StartDeps, 'catalog' | 'unlimitedQuota'>, input: unknown): { ok: true; setup: DebateSetup; kind: DebateKind; aiVoters: ModelId[]; models: ModelSnapshot; budgetMicroUsd: number; quotaPoints: number; selfJudging: boolean; slowAvailable: boolean } | { ok: false; status: 400; error: string }` — all validation and pricing; `startDebate` calls it, then spends Quota and creates the Debate.
  - `db/quota.ts`: `DAILY_QUOTA_POINTS = 24`; `DEBATE_QUOTA_POINTS` / `BATCH_DEBATE_QUOTA_POINTS` removed.
  - `POST /api/debates/quote` (JSON, session or API token, 401 otherwise) → 200 `{ budgetMicroUsd, quotaPoints, quotaRemaining, slowAvailable, panel, selfJudging }` or the `planDebate` 400. Creates and charges nothing.
  - Consumer: `prices` and the client's reasoning function come from `debate.models` when non-null, else the catalog.

- [ ] **Step 1: Write the failing tests** — start: `"api"` For seat stores `{ kind: 'api' }` and a Budget without For model calls; `"api"` with `batch: true` → 400 `'A Slow Debate cannot have an API Debater'`; both benches `"api"` → 201; Quota spent equals `quotaPointsFor(budget)` (a fake line-up priced so the Budget is 30 000 micro-USD spends 3 points); a line-up needing 25+ points → 400 with the verbatim copy, and the same line-up for an unlimited-Quota Member → 201 spending 0; a line-up over $5 → 400 for everyone; a Judge that is not batch-capable with `batch: true` → 400; `planDebate` reports `slowAvailable: false` when either Debater is mandatory-reasoning or lacks a batch price, or is API; `POST /debates/quote` answers 200 with `quotaPoints` and leaves Quota and the debates table untouched; a failed Debate with no cost refunds exactly its points; `models_json` holds every Debater/Judge/voter/screener id with its price. Consumer: a Debate whose snapshot prices model X at 10/10 is charged at 10/10 even when the catalog no longer has X.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/api test -- start consumer db-debates`
- [ ] **Step 3: Implement.** Apply the migration locally (`pnpm --filter @debate-arena/api exec wrangler d1 migrations apply DB --local`) and confirm `apps/api/test/apply-migrations.ts` picks it up.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(api): Quota from the worst-case Budget, quotes, frozen prices, API seats`

### Task 4: API — waiting for an API Turn

**Files:**
- Modify: `apps/api/src/debates/steps.ts`, `apps/api/src/debates/start.ts` (`StepJob`), `apps/api/src/debates/consumer.ts`, `apps/api/src/db/debates.ts`, `apps/api/src/live/events.ts`, `apps/api/src/app.ts` (`publicView`)
- Test: `apps/api/test/steps.test.ts`, `apps/api/test/consumer.test.ts`, `apps/api/test/routes.test.ts`

**Interfaces:**
- Produces:
  - `StepJob` gains `deadlineFor?: number` (a slot index).
  - `StepOutcome` gains `'awaiting' | 'missed'`.
  - `StepDeps` gains `enqueueLater: (job: StepJob, delaySeconds: number) => Promise<void>`.
  - `setTurnDeadline(db, id, deadline: string): Promise<boolean>` (only while running; idempotent: keeps an existing deadline for the same slot so a redelivered step does not extend it — store `"<slot>@<iso>"` or a pair of columns; the implementer picks, tests pin behavior).
  - `DebateEvent` gains `{ type: 'awaiting'; slotIndex: number; deadline: string }`.
  - Public view gains `awaiting: { slotIndex: number; side: Side; deadline: string } | null` (non-null only while running, next slot is API, and a deadline is set).
  - `runStep` for a `deadlineFor` job: if the Debate is running and `turns.length === deadlineFor`, `failStep(…, 'API Debater missed the deadline for slot {n}')` and return `'missed'`; otherwise `'skipped'`.

- [ ] **Step 1: Write the failing tests** — a screened Debate with For `api`: `runStep` returns `'awaiting'`, emits one `awaiting` event with `deadline` = now + 600 s, enqueues `{ debateId, deadlineFor: 0 }` with delay 600 and no normal job; redelivering the same step does not move the deadline; the deadline job with no Turn fails the Debate (Quota refunded when cost is 0); the deadline job after Turn 0 exists returns `'skipped'`; `GET /debates/:id` shows `awaiting`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.** In the consumer, `enqueueLater` is `STEP_QUEUE.send(job, { delaySeconds })`.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(api): wait for an API Debater's Turn until its deadline`

### Task 5: API — `POST /api/debates/:id/turns/:slot`, streamed

**Files:**
- Create: `apps/api/src/debates/api-turn.ts`, `apps/api/test/api-turn.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/auth/member.ts` (a `tokensOnly` option), `apps/api/src/db/moderation.ts`, `packages/engine/src/moderation/screen.ts` (+ test)
- Test: `apps/api/test/api-turn.test.ts`, `packages/engine/src/moderation/screen.test.ts`

**Interfaces:**
- Consumes: Task 4 view/deadline, `createDraftSender`, `appendTurn`, `screenMotion`.
- Produces:
  - `memberResolver(env, { tokensOnly: true })` — only `Authorization: Bearer` API tokens (plus `x-dev-member` when `DEV_AUTH === 'true'`); never the session cookie.
  - `readTurnBody(body: ReadableStream<Uint8Array>, maxBytes: number, onText: (soFar: string) => void): Promise<string>` — decodes with a streaming `TextDecoder` (`{ stream: true }`), throws `TurnTooLargeError` past `maxBytes`.
  - `submitApiTurn(deps: { db; notify; enqueue; screen: (text: string) => Promise<ScreenResult> }, debate: DebateRecord, slot: number, body: ReadableStream<Uint8Array>): Promise<{ status: 201; slotIndex: number; turn: Turn } | { status: 400 | 409 | 413; error: string }>`
  - `buildScreenMessages(text: string, what: 'motion' | 'turn' = 'motion')` — `'turn'` says "Speech submitted to a public debate".
  - `flagDebate(db, id, result: ScreenResult): Promise<void>` — sets `flagged = 1` and Unlists a listed Debate (keeps `screen_json` of the Motion).
  - Route order: 415 unless `text/plain`; 401/403; 404; 410; then `submitApiTurn`. After 201 the screen runs in `executionCtx.waitUntil`, charged through the Debate's metered client (snapshot price).

- [ ] **Step 1: Write the failing tests** (via `exports.default.fetch` with an API token from `auth-helpers.ts`):
  - session cookie only → 401; another Member's token → 403; `application/json` → 415.
  - whole body → 201, Turn stored, `turn` event, next step enqueued, deadline cleared.
  - a `ReadableStream` body sent in 5 pieces with pauses → ≥ 2 `draft` events with growing text, then the Turn; no draft after the `turn` event.
  - a body split inside a multi-byte character (`'é'` across two chunks) → stored text contains `é`.
  - 70 000 bytes, streamed → 413, nothing stored, draft cleared (`text: ''` event).
  - a stream that errors halfway (controller.error) → nothing stored, draft cleared, slot still awaited.
  - wrong slot / AI slot / already-written slot / failed Debate → 409 with `'This Debate is not waiting for Turn {slot}'`.
  - 400 for a whitespace-only body; a 400-word Opening is stored cut to its last full sentence with `truncated: true`.
  - a Turn with `[flag-test]` → Debate becomes Unlisted, `flagged: true`.
  - Turn arrives after the deadline job failed the Debate → 409.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/api test -- api-turn`
- [ ] **Step 3: Implement.** If Task 0 found buffering, also add `PUT /api/debates/:id/turns/:slot/draft` (same auth, slot and 413 rules; 204; one `draft` event per call, cut to the word limit) with tests: a draft PUT emits one `draft` event; a draft PUT for the wrong slot is 409.
- [ ] **Step 4: Run, expect PASS** — and a manual check: `pnpm dev`, start a Debate with `"for":"api"`, then `printf 'One. Two. Three.' | curl -sT - -H 'content-type: text/plain' -H 'x-dev-member: dev' localhost:8787/api/debates/<id>/turns/0` → 201.
- [ ] **Step 5: Commit** — `feat(api): submit an API Debater's Turn, streamed live as drafts`

### Task 6: api-client and CLI — `--for api`, `debate speak`, `models --search`

**Files:**
- Modify: `packages/api-client/src/index.ts`, `packages/cli/src/run.ts`, `packages/cli/src/render.ts`, `packages/cli/src/follow.ts`
- Test: `packages/api-client/src/index.test.ts`, `packages/cli/src/run.test.ts`, `packages/cli/src/render.test.ts`, `packages/cli/src/follow.test.ts`

**Interfaces:**
- Consumes: Task 5 route, Task 4 `awaiting` event and view field, Task 2 `/models` shape.
- Produces:
  - api-client: `submitTurn(baseUrl: string, token: string, debateId: string, slot: number, body: string | ReadableStream<Uint8Array>, fetcher?: typeof fetch): Promise<Response>` (sets `duplex: 'half'` for streams).
  - api-client: `matchesSearch(model: { id: string; label: string }, query: string, provider: string): boolean` — every whitespace-separated word, case-insensitive, appears in label, id or provider. Shared with the web picker.
  - CLI: `debate speak <id> [--slot <n>]` streams `process.stdin` (as a web `ReadableStream`, via `Readable.toWeb`) to `submitTurn`; prints `Turn {n} stored ({words} words)`; if Task 0 found buffering, it also PUTs the text read so far to the draft route at most every 300 ms (best-effort, errors ignored); on 409 prints the API's message and exits 1; without `--slot` reads `awaiting.slotIndex` from `GET /debates/:id` and fails with `This Debate is not waiting for an API Turn` when null. `CliDeps` gains `stdin: ReadableStream<Uint8Array>`.
  - CLI: `start --dry-run` posts to `/api/debates/quote` and prints `{points} Quota points ({left} left today) · worst case ${budget}` (or the JSON with `--json`), starting nothing;
  - CLI: `models --search <words>`; `debaterName` shows `API Debater`; `follow` prints `Waiting for {Side}'s Turn via the API until {HH:MM} UTC` on `awaiting`.
  - USAGE gains `speak <id> [--slot <n>]   Submit the awaited Turn from stdin, streamed as it is read`, and `--for/--against` take `<model|api>`.

- [ ] **Step 1: Write the failing tests** — `speak` with a fake fetch receives the stdin stream with `duplex: 'half'` to `/api/debates/x/turns/2` when the view says `awaiting.slotIndex: 2`; `speak` with `awaiting: null` exits 1 with the message; `models --search "haiku anthropic"` lists only matching ids; `start --for api` posts `"for":"api"`; `start --dry-run` hits `/quote` and never `/debates`; `matchesSearch` unit cases.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/cli test && pnpm --filter @debate-arena/api-client test`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(cli): seat an API Debater and stream its Turns with debate speak`

### Task 7: Web — searchable model picker with the API option

**Files:**
- Create: `apps/web/src/islands/ModelPicker.svelte`, `apps/web/test/model-picker.test.ts`
- Modify: `apps/web/src/islands/StartDebateForm.svelte`, `apps/web/src/pages/new.astro`, `apps/web/src/lib/debate.ts` (`selfJudgingWarning` ignores `'api'`; `DAILY_QUOTA_POINTS = 24`; drop the fixed per-Debate constants), `apps/web/src/components/Header.astro`, `apps/web/src/pages/account.astro`, `apps/web/src/i18n/en.ts` (remove `new.quotaBatchOnly`, `new.points*`, rewrite `new.batchHint` without fixed points)
- Test: `apps/web/test/start-debate-form.test.ts`, `apps/web/e2e/pages.spec.ts` (or a new `apps/web/e2e/new.spec.ts`)

**Interfaces:**
- Consumes: Task 2 `/models` shape (incl. `batch` = batch-capable); Task 3 `POST /api/debates/quote`; Task 6 `matchesSearch`.
- Form behavior: the Slow Debate checkbox renders only when both Debaters are batch-capable models (not API); when a change makes that false it unticks and the `role="status"` line says `new.slowUnavailable` for the offending model. While ticked, the Judge picker gets only batch-capable models. The cost line (`new.cost` / `new.costOne`) comes from `/quote`, requested 300 ms after the last change (stale answers ignored); until it answers it shows nothing; a 400 from `/quote` shows its error at the submit row and disables submit. Submit is disabled while `quotaPoints > quotaRemaining`.
- Produces: `<ModelPicker id label models value allowApi? autoOption? invalid? describedBy? onchange />` where `value` is a model id, `'api'`, or `''` (auto). ARIA 1.2 combobox: `input role="combobox" aria-expanded aria-controls aria-activedescendant aria-autocomplete="list"`, `ul role="listbox"`, options `role="option" aria-selected`. Keys: ArrowDown/ArrowUp move, Enter selects, Escape closes and restores the chosen label, Home/End in the input stay text-editing. Closed state shows the chosen model's label; focus selects the text so typing replaces it. Shows at most `PICKER_MAX_OPTIONS`, then `new.moreMatches`; `new.noMatches` when empty; price line per option via `new.price` (2 significant decimals). A visually-hidden `role="status"` announces the match count after typing settles (300 ms).

- [ ] **Step 1: Write the failing tests** — typing `haiku` shows only Claude Haiku; `anthropic haiku` too; ArrowDown+Enter selects and calls `onchange`; Escape restores the previous label; with 342 models only 50 options render plus the more-matches line; `allowApi` puts `API` first; the form posts `"for":"api"` when API is chosen and shows `new.apiHint`; choosing API on both benches does not raise `new.sameModel`; the Slow Debate checkbox is absent until both Debaters are batch-capable, and choosing a mandatory-reasoning or non-batch model while it is ticked hides and unticks it with the status message; with Slow ticked the Judge picker lists only batch-capable models; the cost line shows `/quote`'s points and a quick second change discards the first answer; submit is disabled when the quote exceeds the Quota left. E2E: on `/new` (fake catalog) type into the For picker, choose a model, start, land on the Debate page; axe passes.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/web test`
- [ ] **Step 3: Implement.** `new.astro` passes the new fields; option list built from props, no client fetch.
- [ ] **Step 4: Run, expect PASS** — web `test`, then `pnpm --filter @debate-arena/web e2e` for the touched spec.
- [ ] **Step 5: Commit** — `feat(web): searchable model picker with an API option`

### Task 8: Web — showing API Debaters on a Debate

**Files:**
- Modify: `apps/web/src/lib/debate.ts` (`debaterLabel`, live event handling), `apps/web/src/islands/TurnItem.svelte`, `apps/web/src/islands/LiveTurns.svelte`, `apps/web/src/islands/PhaseFloor.svelte`, `apps/web/src/components/DebateBand.astro`, `apps/web/src/i18n/en.ts`, `docs/adr/0005-eu-first-gdpr-without-consent-banner.md`
- Test: `apps/web/test/turn-item.test.ts`, `apps/web/test/live-turns.test.ts`, `apps/web/test/debate.test.ts`, `apps/web/e2e/live.spec.ts`

**Interfaces:**
- Consumes: Task 4 `awaiting` event and view field.
- Produces: `TurnItem` prop `debaterKind: 'ai' | 'api' | 'human'` choosing `label.ai` or `label.api`; `debaterLabel` returns `t('debater.api')` for `api`; LiveTurns keeps `awaiting` state (set by the event or the initial view, cleared by a `draft` or `turn` for that slot) and the seat shows `floor.awaiting` with the deadline as a `<time>`.

- [ ] **Step 1: Write the failing tests** — an API Turn shows "Submitted via API" and not "AI-generated"; the bench reads "API Debater"; an `awaiting` event shows "For is preparing a Turn via the API"; a following `draft` switches to "For is speaking"; a stale `awaiting` for an already-filled slot is ignored. E2E (fake catalog, `DEV_AUTH`): start a Debate with For = API via the form, POST a streamed Turn with `x-dev-member` from the test, see the draft then the Turn with "Submitted via API".
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.** Add to ADR 0005's Consequences: "A Turn submitted through the API is labelled as submitted via API, not as AI-generated: the platform did not generate it and cannot know how it was written."
- [ ] **Step 4: Run, expect PASS** — then `pnpm check` and the full `pnpm --filter @debate-arena/web e2e`.
- [ ] **Step 5: Commit** — `feat(web): show API Debaters, their Turns and the wait for them`
