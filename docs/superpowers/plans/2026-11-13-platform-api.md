# Platform API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run real Debates on the platform: a Cloudflare Worker API where a Member starts a Debate, a Queue advances it one model call at a time using `@debate-arena/engine`, D1 stores everything, and a Durable Object pushes each Turn, the Verdict and the AI Audience Result live to Viewers. Fully offline with fake models via `pnpm dev`.

**Architecture:** `apps/api` is a Hono app on Workers. Routes validate input and write to D1 through repositories. The Queue consumer runs `runStep`, which reads a Debate's state and performs the single next step (next Turn, then the Verdict, then the AI Audience) by calling the engine's step functions; the engine stays free of Cloudflare code (ADR 0002, 0003). A `DebateRoom` Durable Object per Debate holds Viewer WebSockets (hibernation API) and broadcasts events the consumer sends it over RPC. Models are reached through the engine's `ModelClient`: `OpenRouterModelClient` in production, `FakeModelClient` locally. `packages/api-client` exports a typed Hono client for every Venue.

**Tech Stack:** Cloudflare Workers, D1 (EU jurisdiction), Queues, Durable Objects (SQLite-backed), Wrangler 4.161, Hono 4.13, `@cloudflare/vitest-plugin` 1.8 (supports Vitest 5), OpenRouter, TypeScript 7.

**Spec:** `GLOSSARY.md`, `docs/adr/0001`–`0006`, roadmap `docs/superpowers/plans/2026-11-13-roadmap.md` (Plan 2 row), and the engine's public API in `packages/engine/src/index.ts`.

## Global Constraints

- The engine stays Cloudflare-free; all Cloudflare code lives in `apps/api`.
- D1 is created in the EU jurisdiction (`wrangler d1 create <name> --jurisdiction=eu`, at creation only; done in Plan 7). Data access only through repositories in `apps/api/src/db/` with portable SQL (ADR 0003).
- LLM calls run in the Queue consumer, never inside the Durable Object (ADR 0003).
- Quota: 6 points per Member per UTC day; a Debate costs 2 points (a Batch Debate will cost 1 in Plan 6). A Debate that fails refunds its points.
- Every Debate reserves `worstCaseBudgetMicroUsd` before it starts and records actual cost (tokens × catalog price) as calls complete.
- Only catalog models may be used as Debaters, Judges or AI Voters. Judge and voter roles only go to models whose reasoning can be switched off.
- `OpenRouterModelClient` always sends `reasoning: { enabled: false }`, so hidden reasoning tokens cannot eat a Judge's or AI Voter's small output cap.
- AI Voters are opt-in per Debate; the platform picks 10 (`AI_VOTER_COUNT`) from the catalog's voter models.
- A Motion is 1–300 characters after trimming.
- Steps are idempotent: a redelivered or duplicate message never creates a second Turn, Verdict or AI Audience Result.
- A step that throws is retried until the message has been attempted `MAX_ATTEMPTS` (2) times; then the Debate becomes `failed`, Viewers get a `failed` event, and its Quota points are refunded.
- `MODEL_PROVIDER` is `fake` by default (local) and `openrouter` in the `production` environment, with the `OPENROUTER_API_KEY` secret.
- Member identity comes from a `MemberResolver`. Until Plan 3 only the dev resolver exists: header `x-dev-member`, honored only when `DEV_AUTH` is `"true"`. Otherwise starting a Debate returns 401.
- Durable Objects are declared with the `exports` form in `wrangler.jsonc` (not legacy `migrations`; the two cannot be mixed later).
- Glossary terms in identifiers, routes and copy (`motion`, `side`, `turn`, `verdict`, `panel`).

## Review Focus

- **Concurrent starts by one Member:** five simultaneous POSTs must start at most three Debates; the Quota update is one atomic statement (Task 3).
- **Duplicate or late queue messages:** a redelivered message after the Debate advanced, completed or failed must do nothing (Task 7).
- **A Judge or AI Voter model that reasons by default:** with reasoning not disabled, a 10-token stance cap returns empty content; the client must always disable reasoning, and the request body is asserted (Task 5).
- **OpenRouter errors and odd responses:** non-2xx status, missing `choices`, `null` content, missing `usage`, and `finish_reason: "length"` must map to a thrown error or a valid `ModelResponse`, never `undefined` text (Task 5).
- **A Viewer connecting after the Debate finished, or to an unknown Debate:** the live route returns 404 for unknown ids and 426 without an upgrade header; late Viewers fetch state over HTTP (Task 8).

---

## File Structure

```
apps/api/
  package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, worker-configuration.d.ts (generated)
  .dev.vars.example                  OPENROUTER_API_KEY placeholder for local real-model runs
  migrations/0001_initial.sql        debates, turns, quota_usage
  src/index.ts                       Worker entry: fetch (Hono), queue consumer, DebateRoom export
  src/app.ts                         Hono routes; exports AppType
  src/auth/member.ts                 MemberResolver, dev resolver
  src/models/catalog.ts              allowed models, prices, roles
  src/models/openrouter.ts           OpenRouterModelClient
  src/models/factory.ts              ModelClient + Catalog by MODEL_PROVIDER; metering wrapper
  src/db/debates.ts                  Debate repository
  src/db/quota.ts                    Quota repository
  src/debates/start.ts               validate, charge Quota, reserve Budget, enqueue
  src/debates/steps.ts               runStep: one step of a Debate
  src/debates/consumer.ts            Queue handler: retries, failure, refund
  src/live/events.ts                 DebateEvent type
  src/live/debate-room.ts            DebateRoom Durable Object
  test/apply-migrations.ts, test/*.test.ts
packages/api-client/
  package.json, tsconfig.json, src/index.ts, src/index.test.ts
```

Tests run in the Workers runtime with `@cloudflare/vitest-plugin`, which provides `env` and `exports` from `cloudflare:workers` and helpers (`applyD1Migrations`, `runInDurableObject`, `createMessageBatch`, `getQueueResult`, `createExecutionContext`, `waitOnExecutionContext`) from `cloudflare:test`.

---

### Task 1: Worker scaffold and test runtime

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.jsonc`, `apps/api/vitest.config.ts`, `apps/api/test/apply-migrations.ts`, `apps/api/migrations/0001_initial.sql` (empty placeholder comment until Task 2), `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/.dev.vars.example`
- Modify: root `package.json` (add `"dev": "turbo run dev"`), `turbo.json` (add `dev` task: `"cache": false, "persistent": true`)
- Test: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: package `@debate-arena/api` (private) with scripts `dev` (`wrangler d1 migrations apply DB --local && wrangler dev`), `typecheck` (`wrangler types && tsc --noEmit`), `test` (`vitest run`), `types` (`wrangler types`). Dependencies: `@debate-arena/engine: workspace:*`, `hono`; dev: `wrangler`, `@cloudflare/vitest-plugin`, `vitest`, `typescript`.
- `wrangler.jsonc`: `name: "debate-arena-api"`, `main: "src/index.ts"`, a `compatibility_date` of today or later, `d1_databases: [{ binding: "DB", database_name: "debate-arena", database_id: "local-debate-arena" }]` (real id set in Plan 7), `queues.producers: [{ binding: "STEP_QUEUE", queue: "debate-steps" }]`, `queues.consumers: [{ queue: "debate-steps", max_batch_size: 10, max_retries: 3, dead_letter_queue: "debate-steps-dlq" }]`, `durable_objects.bindings: [{ name: "DEBATE_ROOM", class_name: "DebateRoom" }]`, `exports: { DebateRoom: { type: "durable-object", storage: "sqlite" } }`, `vars: { MODEL_PROVIDER: "fake", DEV_AUTH: "true" }`, and `env.production.vars: { MODEL_PROVIDER: "openrouter", DEV_AUTH: "false" }` (vars are not inherited, so production repeats both). No `nodejs_compat`.
- `app.ts`: `export const app = new Hono<{ Bindings: Env }>().get('/health', c => c.json({ ok: true }))`; later tasks chain routes onto it and `export type AppType = typeof app`.
- `index.ts`: `export default { fetch: app.fetch, queue: consumer }` once Task 7 exists (until then only `fetch`); `export { DebateRoom }` once Task 8 exists.
- `vitest.config.ts`: `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: { TEST_MIGRATIONS: migrations } } })` with `readD1Migrations('./migrations')`, and `setupFiles: ['./test/apply-migrations.ts']`, which calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`. `tsconfig.json` adds `"types": ["@cloudflare/vitest-plugin/types"]` and includes `worker-configuration.d.ts`.

- [ ] **Step 1: Scaffold and install**

`pnpm --filter @debate-arena/api add hono @debate-arena/engine@workspace:*` and `pnpm --filter @debate-arena/api add -D wrangler @cloudflare/vitest-plugin vitest typescript`. Then run `pnpm --filter @debate-arena/api types` to generate `worker-configuration.d.ts`.

- [ ] **Step 2: Write the failing test**

```ts
import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
test('health check responds', async () => {
  const res = await exports.default.fetch('https://api.test/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @debate-arena/api test -- health`
Expected: FAIL (404 or missing handler) before `app.ts` defines the route.

- [ ] **Step 4: Implement `app.ts` and `index.ts`; run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- health && pnpm check`
Expected: PASS; root check still green (engine 61 tests + api 1).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(api): Workers app scaffold with D1, Queue and Durable Object bindings"
```

---

### Task 2: D1 schema and Debate repository

**Files:**
- Modify: `apps/api/migrations/0001_initial.sql`
- Create: `apps/api/src/db/debates.ts`
- Test: `apps/api/test/db-debates.test.ts`

**Interfaces:**
- Consumes: engine types `DebateSetup`, `Turn`, `Verdict`, `ModelId`, `AiAudienceResult`.
- Produces:

```ts
export type DebateStatus = 'running' | 'complete' | 'failed';
export interface DebateRecord {
  id: string; memberId: string; status: DebateStatus; setup: DebateSetup; aiVoters: ModelId[];
  selfJudging: boolean; quotaPoints: number; budgetReservedMicroUsd: number; costMicroUsd: number;
  turns: Turn[]; verdict: Verdict | null; aiAudience: AiAudienceResult | null;
  createdAt: string; completedAt: string | null; failureReason: string | null;
}
export type NewDebate = Pick<DebateRecord, 'id' | 'memberId' | 'setup' | 'aiVoters' | 'selfJudging' | 'quotaPoints' | 'budgetReservedMicroUsd' | 'createdAt'>;
export function createDebate(db: D1Database, debate: NewDebate): Promise<void>;
export function getDebate(db: D1Database, id: string): Promise<DebateRecord | null>;
export function listCompletedDebates(db: D1Database, limit: number, before?: string): Promise<DebateRecord[]>; // newest completedAt first; turns omitted ([])
export function appendTurn(db: D1Database, id: string, slotIndex: number, turn: Turn): Promise<boolean>; // false if slot exists
export function saveVerdict(db: D1Database, id: string, verdict: Verdict): Promise<boolean>; // false if already set
export function completeDebate(db: D1Database, id: string, aiAudience: AiAudienceResult | null, at: string): Promise<boolean>; // only from 'running'
export function failDebate(db: D1Database, id: string, reason: string): Promise<boolean>; // only from 'running'
export function addCost(db: D1Database, id: string, microUsd: number): Promise<void>;
```

Schema: `debates` (id TEXT PRIMARY KEY, member_id, status, setup_json, ai_voters_json, self_judging INTEGER, quota_points INTEGER, budget_reserved_micro_usd INTEGER, cost_micro_usd INTEGER NOT NULL DEFAULT 0, verdict_json, ai_audience_json, created_at, completed_at, failure_reason) with an index on `(status, completed_at)`; `turns` (debate_id, slot_index, phase_index, side, text, truncated INTEGER, PRIMARY KEY (debate_id, slot_index)). ISO-8601 UTC timestamps. `appendTurn` uses `INSERT ... ON CONFLICT DO NOTHING`; the conditional updates use `WHERE` clauses (`verdict_json IS NULL`, `status = 'running'`) and return `meta.changes === 1`.

- [ ] **Step 1: Write the failing tests**

```ts
test('round-trips a new Debate', async () => { /* createDebate then getDebate → status 'running', turns [], verdict null, costMicroUsd 0 */ });
test('appendTurn is idempotent per slot', async () => {
  expect(await appendTurn(env.DB, id, 0, turn0)).toBe(true);
  expect(await appendTurn(env.DB, id, 0, turn0)).toBe(false);
  expect((await getDebate(env.DB, id))?.turns).toHaveLength(1);
});
test('Turns come back in slot order', async () => { /* append slot 1 then 0 → turns[0] is slot 0's Turn */ });
test('saveVerdict and completeDebate apply once', async () => { /* second call false, first values kept */ });
test('a failed Debate cannot complete', async () => { /* failDebate → completeDebate false, status 'failed', failureReason kept */ });
test('listCompletedDebates is newest first and paginates', async () => { /* 3 complete + 1 running → limit 2, then before=<2nd completedAt> returns the 3rd */ });
test('addCost accumulates', async () => { /* 100 + 250 → 350 */ });
test('getDebate returns null for unknown ids', async () => { expect(await getDebate(env.DB, 'nope')).toBeNull(); });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @debate-arena/api test -- db-debates`
Expected: FAIL, cannot resolve `../src/db/debates`.

- [ ] **Step 3: Write the migration and implement the repository**

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- db-debates`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations apps/api/src/db/debates.ts apps/api/test/db-debates.test.ts
git commit -m "feat(api): D1 schema and Debate repository"
```

---

### Task 3: Quota

**Files:**
- Modify: `apps/api/migrations/0001_initial.sql` (table `quota_usage`)
- Create: `apps/api/src/db/quota.ts`
- Test: `apps/api/test/quota.test.ts`

**Interfaces:**
- Produces:

```ts
export const DAILY_QUOTA_POINTS = 6;
export const DEBATE_QUOTA_POINTS = 2;
export function utcDay(at: Date | string): string; // 'YYYY-MM-DD'
export function spendQuota(db: D1Database, memberId: string, points: number, now: Date): Promise<boolean>;
export function refundQuota(db: D1Database, memberId: string, points: number, day: string): Promise<void>;
export function quotaRemaining(db: D1Database, memberId: string, now: Date): Promise<number>;
```

Table `quota_usage` (member_id, day, points INTEGER NOT NULL, PRIMARY KEY (member_id, day)). `spendQuota` is one atomic statement: `INSERT INTO quota_usage VALUES (?, ?, ?) ON CONFLICT (member_id, day) DO UPDATE SET points = points + excluded.points WHERE points + excluded.points <= 6`, guarded so a first insert above 6 is impossible (`points` ≤ 6 is checked in code before the statement), returning `meta.changes === 1`. `refundQuota` never goes below 0.

- [ ] **Step 1: Write the failing tests**

```ts
test('three Debates fit in a day, the fourth does not', async () => {
  for (let i = 0; i < 3; i++) expect(await spendQuota(env.DB, 'm1', 2, noon)).toBe(true);
  expect(await spendQuota(env.DB, 'm1', 2, noon)).toBe(false);
  expect(await quotaRemaining(env.DB, 'm1', noon)).toBe(0);
});
test('the day rolls over at UTC midnight', async () => { /* spend 6 at 23:59Z; spend 2 at next day 00:00Z → true */ });
test('Members have separate Quotas', async () => { /* m1 exhausted; m2 → true */ });
test('refunds restore points for that day, never below zero', async () => { /* spend 6, refund 2 → 2 left; refund 10 → 6 left */ });
test('concurrent spends never exceed the Quota', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => spendQuota(env.DB, 'm3', 2, noon)));
  expect(results.filter(Boolean)).toHaveLength(3);
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- quota`
Expected: FAIL before, PASS after (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations apps/api/src/db/quota.ts apps/api/test/quota.test.ts
git commit -m "feat(api): per-Member daily Quota"
```

---

### Task 4: Model catalog

**Files:**
- Create: `apps/api/src/models/catalog.ts`
- Test: `apps/api/test/catalog.test.ts`

**Interfaces:**
- Consumes: engine `PriceTable`, `ModelPrice`, `ModelId`, `modelFamily`.
- Produces:

```ts
export type ModelRole = 'debater' | 'judge' | 'voter';
export interface CatalogEntry { id: ModelId; label: string; price: ModelPrice; roles: ModelRole[] }
export interface Catalog { entries: CatalogEntry[] }
export const PRODUCTION_CATALOG: Catalog;
export const FAKE_CATALOG: Catalog;   // 'fake-a/one', 'fake-b/one', 'fake-c/one', 'fake-d/one' with every role, plus 'fake-a/debater-only' (debater only); price 1/1
export const AI_VOTER_COUNT = 10;
export function priceTable(catalog: Catalog): PriceTable;
export function modelsFor(catalog: Catalog, role: ModelRole): ModelId[];
export function hasRole(catalog: Catalog, id: ModelId, role: ModelRole): boolean;
export function pickAiVoters(catalog: Catalog, count: number): ModelId[]; // round-robin over families in catalog order
```

`PRODUCTION_CATALOG` holds real OpenRouter ids and prices copied at implementation time from `GET https://openrouter.ai/api/v1/models` (`pricing.prompt` and `pricing.completion` are USD per token; multiply by 1,000,000). Give `judge` and `voter` roles only to models whose OpenRouter entry does not mark reasoning as mandatory. At least three families must have `judge` and three `voter`.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([['production', PRODUCTION_CATALOG], ['fake', FAKE_CATALOG]])('%s: entries have valid prices, roles and ids', (_, c) => {
  for (const e of c.entries) {
    for (const p of [e.price.inputPerMTokUsd, e.price.outputPerMTokUsd]) expect(Number.isFinite(p) && p >= 0).toBe(true);
    expect(e.roles.length).toBeGreaterThan(0);
    expect(e.id).toMatch(/^[^/]+\/[^/]+$/);
  }
  expect(new Set(c.entries.map(e => e.id)).size).toBe(c.entries.length);
});
test.each([['production', PRODUCTION_CATALOG], ['fake', FAKE_CATALOG]])('%s: Judges and voters span three families', (_, c) => {
  expect(new Set(modelsFor(c, 'judge').map(modelFamily)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(modelsFor(c, 'voter').map(modelFamily)).size).toBeGreaterThanOrEqual(3);
});
test('ten AI Voters rotate across families', () => {
  const voters = pickAiVoters(FAKE_CATALOG, AI_VOTER_COUNT);
  expect(voters).toHaveLength(10);
  for (let i = 1; i < voters.length; i++) expect(modelFamily(voters[i]!)).not.toBe(modelFamily(voters[i - 1]!));
});
test('priceTable covers exactly the catalog', () => { /* Object.keys(priceTable(FAKE_CATALOG)) equals entry ids */ });
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- catalog`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/models/catalog.ts apps/api/test/catalog.test.ts
git commit -m "feat(api): model catalog with prices and roles"
```

---

### Task 5: OpenRouter client, provider factory and metering

**Files:**
- Create: `apps/api/src/models/openrouter.ts`, `apps/api/src/models/factory.ts`
- Test: `apps/api/test/openrouter.test.ts`, `apps/api/test/factory.test.ts`

**Interfaces:**
- Consumes: engine `ModelClient`, `ModelRequest`, `ModelResponse`, `FakeModelClient`, `PriceTable`; Task 4 catalogs.
- Produces:

```ts
export class OpenRouterError extends Error { constructor(message: string, readonly status: number | null) }
export class OpenRouterModelClient implements ModelClient {
  constructor(apiKey: string, fetcher?: typeof fetch); // fetcher defaults to globalThis.fetch
  complete(request: ModelRequest): Promise<ModelResponse>;
}
export interface Models { client: ModelClient; catalog: Catalog }
export function createModels(env: Pick<Env, 'MODEL_PROVIDER'> & { OPENROUTER_API_KEY?: string }): Models; // throws if openrouter without key
export function meteredClient(client: ModelClient, prices: PriceTable, onCost: (microUsd: number) => Promise<void>): ModelClient;
```

Request: `POST https://openrouter.ai/api/v1/chat/completions`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, `HTTP-Referer: https://github.com/motiko/debate-arena`, `X-OpenRouter-Title: Debate Arena`; body `{ model, messages, max_tokens: maxOutputTokens, reasoning: { enabled: false } }`. Response mapping: `text = choices[0].message.content ?? ''`, `inputTokens = usage.prompt_tokens ?? 0`, `outputTokens = usage.completion_tokens ?? 0`, `finishReason = 'length'` when `choices[0].finish_reason === 'length'`, else `'stop'`. A non-2xx status, a body without `choices[0]`, or `finish_reason === 'error'` throws `OpenRouterError`. `meteredClient` calls `onCost(ceil(inputTokens × inputPerMTokUsd + outputTokens × outputPerMTokUsd))` after each successful call.

- [ ] **Step 1: Write the failing tests** (a stub `fetcher` records the request and returns canned JSON)

```ts
test('sends the model, messages, token cap and disabled reasoning', async () => {
  await client.complete({ model: 'a/x', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 });
  expect(sent.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(sent.headers.get('authorization')).toBe('Bearer test-key');
  expect(JSON.parse(sent.body)).toEqual({ model: 'a/x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10, reasoning: { enabled: false } });
});
test('maps text, usage and a length stop', async () => {
  // reply: { choices: [{ message: { content: 'Hello' }, finish_reason: 'length' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }
  expect(await client.complete(req)).toEqual({ text: 'Hello', inputTokens: 12, outputTokens: 3, finishReason: 'length' });
});
test('null content becomes empty text and missing usage becomes zero', async () => { /* → { text: '', inputTokens: 0, outputTokens: 0, finishReason: 'stop' } */ });
test.each([[500, { error: { message: 'boom' } }], [200, {}], [200, { choices: [{ message: { content: 'x' }, finish_reason: 'error' }] }]])(
  'status %i with %j throws OpenRouterError', async (status, body) => { /* rejects.toBeInstanceOf(OpenRouterError) */ });
// factory.test.ts
test('fake provider uses the fake catalog', () => { /* createModels({ MODEL_PROVIDER: 'fake' }).catalog === FAKE_CATALOG; client instanceof FakeModelClient */ });
test('openrouter provider requires a key', () => { /* throws without OPENROUTER_API_KEY */ });
test('metering reports cost from tokens and prices', async () => { /* FakeModelClient reply 'one two' (2 tokens), input 'a b c' (3), price in 2 / out 5 → onCost(16) */ });
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- openrouter factory`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/models apps/api/test/openrouter.test.ts apps/api/test/factory.test.ts
git commit -m "feat(api): OpenRouter client with reasoning disabled, provider factory and metering"
```

---

### Task 6: Starting a Debate and reading Debates

**Files:**
- Create: `apps/api/src/auth/member.ts`, `apps/api/src/debates/start.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/start.test.ts`, `apps/api/test/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; engine `CLASSIC_FORMAT`, `suggestPanel`, `validatePanel`, `isSelfJudging`, `worstCaseBudgetMicroUsd`.
- Produces:

```ts
// auth/member.ts
export type MemberResolver = (request: Request) => Promise<string | null>;
export function devMemberResolver(env: Pick<Env, 'DEV_AUTH'>): MemberResolver; // x-dev-member header when DEV_AUTH === 'true', else always null
// debates/start.ts
export interface StartDebateInput { motion: string; debaters: { for: ModelId; against: ModelId }; panel?: ModelId[]; aiVoters: boolean }
export interface StepJob { debateId: string }
export interface StartDeps { db: D1Database; catalog: Catalog; enqueue: (job: StepJob) => Promise<void>; now: () => Date; newId: () => string }
export type StartResult =
  | { ok: true; id: string; panel: ModelId[]; selfJudging: boolean; budgetReservedMicroUsd: number }
  | { ok: false; status: 400 | 429; error: string };
export const MAX_MOTION_LENGTH = 300;
export function startDebate(deps: StartDeps, memberId: string, input: unknown): Promise<StartResult>;
```

`startDebate` order: validate the input shape and Motion (trimmed, 1–300 characters) → Debaters have role `debater` → Panel: given Panel must pass `validatePanel` and every Judge must have role `judge`; otherwise `suggestPanel(debaters, modelsFor(catalog, 'judge'))` → AI Voters `pickAiVoters(catalog, AI_VOTER_COUNT)` when opted in → `worstCaseBudgetMicroUsd` with `priceTable(catalog)` → `spendQuota(DEBATE_QUOTA_POINTS)` (429 `"Daily Debate limit reached"` when false) → `createDebate` → `enqueue({ debateId })`. If `enqueue` throws: `failDebate` and `refundQuota`, then rethrow. Error messages name the problem plainly (e.g. `"Motion must be 1–300 characters"`, `"Model x/y cannot be a Debater"`).

Routes chained in `app.ts`:

| Route | Result |
|---|---|
| `GET /models` | 200 `{ models: { id, label, roles }[] }` from the active catalog |
| `POST /debates` | 401 without a Member; 400 / 429 from `startDebate`; 201 `{ id, panel, selfJudging }` |
| `GET /debates/:id` | 404 or 200 public view: `{ id, status, motion, format: { id, name, phases }, debaters, panel, selfJudging, aiVoters: boolean, turns, verdict, aiAudience, createdAt, completedAt }` (no `memberId`, Budget or cost) |
| `GET /debates?before=<iso>` | 200 `{ debates: summary[] }`, 20 newest complete Debates; summary is the public view without `turns` |

- [ ] **Step 1: Write the failing tests**

```ts
// start.test.ts (FAKE_CATALOG, collected enqueue, fixed now)
test('starts a Debate: suggested Panel, Budget reserved, Quota spent, one job queued', async () => {
  const r = await startDebate(deps, 'm1', { motion: 'Remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false });
  expect(r).toMatchObject({ ok: true, selfJudging: false });
  expect(jobs).toEqual([{ debateId: r.ok ? r.id : '' }]);
  expect(await quotaRemaining(env.DB, 'm1', now)).toBe(4);
  expect((await getDebate(env.DB, r.ok ? r.id : ''))?.budgetReservedMicroUsd).toBeGreaterThan(0);
});
test.each([['', 'empty'], ['x'.repeat(301), 'too long']])('rejects a Motion that is %s', async (motion) => { /* 400 */ });
test('rejects models outside the catalog or role', async () => { /* debater 'evil/model' → 400; panel ['fake-a/debater-only'] → 400 */ });
test('rejects a Panel of two Judges', async () => { /* 400 */ });
test('an explicit same-model Judge is allowed and flagged as Self-Judging', async () => { /* selfJudging true */ });
test('opting into AI Voters stores ten of them and raises the Budget', async () => { /* aiVoters length 10, budget > without */ });
test('the fourth Debate of the day is refused with 429', async () => { /* three ok, fourth 429, no 4th row */ });
test('a failed enqueue refunds the Quota and fails the Debate', async () => { /* enqueue throws → rejects; quotaRemaining 6; status 'failed' */ });
// routes.test.ts (exports.default.fetch)
test('POST /debates without a Member is 401', async () => { /* no x-dev-member header */ });
test('POST then GET returns the public view without private fields', async () => { /* 201; GET 200; no memberId/budgetReservedMicroUsd/costMicroUsd keys */ });
test('GET /debates/:id for an unknown id is 404', async () => {});
test('GET /models lists the fake catalog locally', async () => {});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- start routes`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(api): start Debates with Quota and Budget, and read them"
```

---

### Task 7: Debate steps and the Queue consumer

**Files:**
- Create: `apps/api/src/live/events.ts`, `apps/api/src/debates/steps.ts`, `apps/api/src/debates/consumer.ts`
- Modify: `apps/api/src/index.ts` (add `queue`)
- Test: `apps/api/test/steps.test.ts`, `apps/api/test/consumer.test.ts`

**Interfaces:**
- Consumes: Task 2 repository, Task 3 `refundQuota`/`utcDay`, Task 5 `createModels`/`meteredClient`, engine `nextSlot`, `turnSlots`, `generateTurn`, `judgeDebate`, `runAiAudience`, `MAX_ATTEMPTS`.
- Produces:

```ts
// live/events.ts
export type DebateEvent =
  | { type: 'turn'; slotIndex: number; turn: Turn }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'complete'; aiAudience: AiAudienceResult | null }
  | { type: 'failed'; reason: string };
// debates/steps.ts
export interface StepDeps { db: D1Database; client: ModelClient; notify: (debateId: string, event: DebateEvent) => Promise<void>; enqueue: (job: StepJob) => Promise<void>; now: () => Date }
export type StepOutcome = 'turn' | 'verdict' | 'complete' | 'skipped';
export function runStep(deps: StepDeps, job: StepJob): Promise<StepOutcome>;
export function failStep(deps: Pick<StepDeps, 'db' | 'notify'>, debateId: string, reason: string): Promise<void>;
// debates/consumer.ts
export function consumer(batch: MessageBatch<StepJob>, env: Env, ctx: ExecutionContext): Promise<void>;
```

`runStep` reads the Debate and does exactly one thing: not found or not `running` → `'skipped'`; a next slot exists → `generateTurn`, `appendTurn`, and only if it was written: notify `turn`, enqueue the next job → `'turn'`; no Verdict → `judgeDebate`, `saveVerdict`, and only if it was written: notify `verdict`, enqueue → `'verdict'`; else run `runAiAudience` when the Debate has AI Voters, `completeDebate`, and only if it changed the row: notify `complete` → `'complete'`. A step whose write lost a race returns `'skipped'`. `failStep` calls `failDebate`; only if it changed the row: `refundQuota(memberId, quotaPoints, utcDay(createdAt))` and notify `failed`. The consumer builds `StepDeps` from `env` (client = `meteredClient(models.client, priceTable(models.catalog), cost => addCost(db, id, cost))`, notify via `env.DEBATE_ROOM.getByName(id).broadcast(event)`, enqueue via `env.STEP_QUEUE.send`) and handles each message: success → `ack()`; throw with `message.attempts < MAX_ATTEMPTS` → `retry({ delaySeconds: 5 })`; otherwise `failStep` with the error's message, then `ack()`. Until Task 8 adds the Durable Object, `notify` is a no-op in tests through `StepDeps`.

- [ ] **Step 1: Write the failing tests**

```ts
// steps.test.ts — real D1, FakeModelClient answering by maxOutputTokens (800 → verdict JSON, 10 → 'for', else 'An argument.'), recorded notify/enqueue
test('drives a Classic Debate to completion one step at a time', async () => {
  const outcomes = [];
  while (jobs.length) outcomes.push(await runStep(deps, jobs.shift()!));
  expect(outcomes).toEqual(['turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'verdict', 'complete']);
  const d = await getDebate(env.DB, id);
  expect(d).toMatchObject({ status: 'complete', verdict: { winner: 'for' } });
  expect(d?.turns).toHaveLength(6);
  expect(events.map(e => e.type)).toEqual(['turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'verdict', 'complete']);
});
test('with AI Voters the completion carries the AI Audience Result', async () => { /* complete event aiAudience.counted === 10 */ });
test('a redelivered job running concurrently writes one Turn and notifies once', async () => {
  const outcomes = await Promise.all([runStep(deps, job), runStep(deps, job)]);
  expect(outcomes.sort()).toEqual(['skipped', 'turn']);
  expect((await getDebate(env.DB, id))?.turns).toHaveLength(1);
  expect(events.filter(e => e.type === 'turn')).toHaveLength(1);
  expect(jobs).toHaveLength(1);
});
test('jobs for complete or failed Debates are skipped', async () => { /* 'skipped', no model calls */ });
test('failStep refunds Quota once and notifies failed once', async () => { /* call twice → quotaRemaining back to 6, one 'failed' event */ });
// consumer.test.ts — createMessageBatch + getQueueResult
test('a successful step is acked', async () => { /* explicitAcks contains the message id */ });
test('a first failure is retried, the second fails the Debate', async () => { /* attempts 1 → retried; attempts 2 → acked and status 'failed' */ });
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- steps consumer`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(api): Queue-driven Debate steps with retries, failure and refunds"
```

---

### Task 8: Live Debates through the DebateRoom Durable Object

**Files:**
- Create: `apps/api/src/live/debate-room.ts`
- Modify: `apps/api/src/index.ts` (export `DebateRoom`), `apps/api/src/app.ts` (live route), `apps/api/src/debates/consumer.ts` (real `notify`)
- Test: `apps/api/test/live.test.ts`

**Interfaces:**
- Consumes: Task 7 `DebateEvent`.
- Produces:

```ts
export class DebateRoom extends DurableObject<Env> {
  fetch(request: Request): Promise<Response>;      // accepts a Viewer WebSocket via ctx.acceptWebSocket (hibernation)
  broadcast(event: DebateEvent): Promise<number>;  // RPC; sends JSON to every open socket, returns how many
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>; // replies {"type":"pong"} to "ping", ignores the rest
  webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void>;
}
```

Route `GET /debates/:id/live`: 404 for an unknown Debate; 426 `"Expected a WebSocket upgrade"` without `Upgrade: websocket`; otherwise `return env.DEBATE_ROOM.getByName(id).fetch(c.req.raw)`. The room holds no Debate state; Viewers load current state with `GET /debates/:id` and then apply events.

- [ ] **Step 1: Write the failing tests**

```ts
test('a Viewer socket receives broadcast events', async () => {
  const res = await exports.default.fetch(`https://api.test/debates/${id}/live`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!; ws.accept();
  const got = new Promise<string>(r => ws.addEventListener('message', e => r(e.data as string)));
  expect(await env.DEBATE_ROOM.getByName(id).broadcast({ type: 'failed', reason: 'test' })).toBe(1);
  expect(JSON.parse(await got)).toEqual({ type: 'failed', reason: 'test' });
});
test('ping gets pong', async () => {});
test('live route: 426 without upgrade, 404 for unknown Debate', async () => {});
test('the consumer broadcasts each Turn to the room', async () => { /* open socket, run one consumer batch, receive a 'turn' event */ });
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api test -- live`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(api): DebateRoom Durable Object streams Debate events to Viewers"
```

---

### Task 9: Typed API client

**Files:**
- Create: `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/src/index.ts`
- Test: `packages/api-client/src/index.test.ts`

**Interfaces:**
- Consumes: `AppType` from `@debate-arena/api` (type-only import; add `"exports": { "./app-type": "./src/app.ts" }` to the api package), `DebateEvent` type.
- Produces: `createApiClient(baseUrl: string, init?: { fetch?: typeof fetch; headers?: Record<string, string> }) => ReturnType<typeof hc<AppType>>`; re-exports `type DebateEvent` and the public Debate view types via `InferResponseType`. Same `hono` version as `apps/api`.

- [ ] **Step 1: Write the failing tests** (Node-side: URL building and headers; route types are proven by the typecheck below)

```ts
test('builds typed request URLs', () => {
  const client = createApiClient('https://api.test');
  expect(client.debates[':id'].$url({ param: { id: 'd1' } }).toString()).toBe('https://api.test/debates/d1');
});
test('sends custom headers', async () => { /* fetch stub records x-dev-member on client.debates.$post */ });
```

Typecheck is part of the contract: `pnpm --filter @debate-arena/api-client typecheck` must pass, proving `AppType` resolves.

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/api-client test && pnpm --filter @debate-arena/api-client typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/api-client apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api-client): typed Hono client for all Venues"
```

---

### Task 10: Offline `pnpm dev` and an end-to-end run

**Files:**
- Modify: `README.md` (create if absent: how to run `pnpm dev` and start a Debate locally)
- Test: manual run below, plus `pnpm check`

- [ ] **Step 1: Run the whole check**

Run: `pnpm check`
Expected: lint clean, typecheck clean, engine and api and api-client tests pass.

- [ ] **Step 2: Start the platform offline**

Run: `pnpm dev` (no network needed beyond the first install).
Expected: local migrations applied; Wrangler serves on `http://localhost:8787`.

- [ ] **Step 3: Start a Debate and watch it complete**

```bash
curl -s -X POST localhost:8787/debates -H 'content-type: application/json' -H 'x-dev-member: dev-1' \
  -d '{"motion":"Remote work beats office work","debaters":{"for":"fake-a/one","against":"fake-b/one"},"aiVoters":true}'
curl -s localhost:8787/debates/<id>
```

Expected: within a few seconds `status` is `complete` with 6 Turns, a Verdict and an AI Audience Result. If local Queues do not deliver, record that as a ruling and add a `DEV_INLINE_STEPS` fallback that runs `runStep` via `ctx.waitUntil` instead of the Queue in dev only.

- [ ] **Step 4: Document and commit**

README: prerequisites (Node 24, pnpm), `pnpm install`, `pnpm dev`, the curl example, `x-dev-member` explained, and `MODEL_PROVIDER=openrouter` with `OPENROUTER_API_KEY` in `apps/api/.dev.vars` for real models.

```bash
git add README.md
git commit -m "docs: run the platform locally"
```
