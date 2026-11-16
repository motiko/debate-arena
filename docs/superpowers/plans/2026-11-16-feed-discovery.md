# Feed discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI-assigned Categories and Tags on every Debate, plus search, filters and numbered pagination on the feed.

**Architecture:** The engine gains a `labelMotion` step (like `screenMotion`) run by a cheap curated `labeller`
model in the screen step, reserved in the Budget and saved with the screen. D1 stores `category` and `tags_json`;
`GET /api/debates` filters with SQL (`LIKE`, `json_extract`, `json_each`) and pages with `LIMIT/OFFSET` + a count.
The Astro feed renders a GET form, Category links, Tag links and numbered pages without client JS.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers + D1, Vitest (workers pool), Astro + Svelte 5, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-16-feed-discovery-design.md`

## Global Constraints

- Categories, exactly: `politics, economics, technology, science, health, environment, philosophy, society, culture, sport`.
- Tags: 1–3 per Debate, lower case, characters `[a-z0-9 -]`, 2–24 chars, deduplicated.
- Labelling never fails or Flags a Debate; only `BudgetExhaustedError` escapes.
- Labels shown to Viewers carry the AI-generated label (`AiLabel.astro`, ADR 0005).
- Page size stays `FEED_PAGE_SIZE = 20`. Search: at most 5 words, query trimmed to 100 chars.
- No formatter; oxlint + typecheck + tests must pass (`pnpm check`), web build + e2e must pass.
- Strings go in `apps/web/src/i18n/en.ts`; GLOSSARY terms are capitalised (Category, Tag).

## Review Focus

- Search terms containing `%`, `_` or `\` match literally, not as wildcards → test in Task 4.
- `page=0`, `page=-3`, `page=abc`, `page=999` → page 1 for junk, an empty page (with correct pageCount) past the end → Task 4.
- Unknown `category`/`kind` values are ignored, not 500s → Task 4.
- A labeller reply that is prose, has an unknown category, or tags with punctuation → null / cleaned tags → Task 1.
- Unlisted, Blocked, running and failed Debates never appear in search, tag counts or backfill results → Task 4/5.

---

### Task 1: Engine labelling

**Files:**
- Create: `packages/engine/src/labels/label.ts`, `packages/engine/src/labels/label.test.ts`
- Modify: `packages/engine/src/index.ts`, `packages/engine/src/budget/estimate.ts` (+ its test)

**Interfaces:**
- Produces: `CATEGORIES` (readonly tuple), `type Category`, `interface Labels { category: Category; tags: string[] }`,
  `LABEL_OUTPUT_TOKENS = 80` (distinct from SCREEN 16, STANCE, JUDGE caps), `buildLabelMessages(motion): ModelMessage[]`,
  `parseLabels(text): Labels | null`, `normaliseTag(raw: string): string | null`,
  `labelMotion(motion, model, client, { rethrow? }): Promise<Labels | null>`;
  `worstCaseBudgetMicroUsd(setup, aiVoters, prices, screener?, labeller?)` adds `cost(labeller, base, LABEL_OUTPUT_TOKENS)`.

- [ ] Tests: `parseLabels('{"category":"technology","tags":["AI","Remote Work!"]}')` → `{category:'technology', tags:['ai','remote work']}`;
  reply wrapped in prose/code fence still parses; unknown category → null; non-JSON → null; >3 tags keeps first 3;
  duplicate/too-short tags dropped; `labelMotion` with a throwing FakeModelClient → null, with `rethrow` → throws;
  budget with a labeller is greater than without by exactly one labelling call.
- [ ] Run `pnpm --filter @debate-arena/engine test` → FAIL, implement, → PASS. Prompt includes `UNTRUSTED_NOTICE`, the list of categories, and asks for JSON only.
- [ ] Commit `feat(engine): label a Motion with a Category and Tags`.

### Task 2: Catalog role, plan and step

**Files:**
- Modify: `apps/api/src/models/catalog.ts`, `apps/api/src/models/factory.ts`, `apps/api/src/debates/start.ts`,
  `apps/api/src/debates/steps.ts`, `apps/api/src/debates/consumer.ts`, `apps/api/src/db/moderation.ts` (saveScreen),
  `apps/api/src/db/debates.ts` (record fields)
- Create: `apps/api/migrations/0010_debate_labels.sql`
- Test: `apps/api/test/catalog.test.ts`, `apps/api/test/start.test.ts`, `apps/api/test/steps.test.ts`, `apps/api/test/db-debates.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `ModelRole` gains `'labeller'`; `labellerFor(catalog): ModelId`; `StepDeps.labeller: ModelId`;
  `saveScreen(db, id, result, at, labels?: Labels | null)`; `DebateRecord.category: Category | null`, `DebateRecord.tags: string[]`;
  `saveLabels(db, id, labels: Labels): Promise<void>`.
- Migration: `ALTER TABLE debates ADD COLUMN category TEXT; ALTER TABLE debates ADD COLUMN tags_json TEXT; CREATE INDEX debates_category_completed_at ON debates (category, completed_at);`
- Production: Mistral Small gets roles `['voter', 'labeller']`; fake catalog adds `fake-label/one` (roles `['labeller']`).
  `catalogFor(…,'batch')` keeps screener and labeller entries at normal price. `devFakeReply` answers `LABEL_OUTPUT_TOKENS`
  requests with JSON choosing `CATEGORIES[seed % 10]` and tags `['local dev', 'fake']`.

- [ ] Tests: `labellerFor` of both catalogs; `planDebate` freezes the labeller's price and its budget exceeds the same plan
  computed without a labeller; the screen step saves category and tags; a labeller that throws a generic error still
  screens and leaves category null; `getDebate` returns `category: null, tags: []` for an unlabelled row.
- [ ] Run `pnpm --filter @debate-arena/api test` → FAIL, implement, → PASS.
- [ ] Commit `feat(api): label each Debate's Motion when it is screened`.

### Task 3: GLOSSARY

- [ ] Add **Category** and **Tag** under "Running a Debate"; Budget's definition mentions labelling. Commit with Task 2.

### Task 4: Feed query and API

**Files:**
- Create: `apps/api/src/db/feed.ts` (the new queries; `listCompletedDebates` stays where it is), `apps/api/test/feed-search.test.ts`
- Modify: `apps/api/src/app.ts` (`GET /debates`, `GET /tags`, `publicView` adds `category`, `tags`)

**Interfaces:**
- Produces: `interface FeedQuery { q?: string; category?: Category; tag?: string; model?: string; kind?: DebateKind; page: number }`,
  `parseFeedQuery(params: URLSearchParams | Record<string,string|undefined>): FeedQuery`,
  `searchDebates(db, query, pageSize): Promise<{ debates: DebateRecord[]; total: number }>`,
  `popularTags(db, limit = 20): Promise<{ tag: string; count: number }[]>`.
  Response of `GET /api/debates` without `before`: `{ debates, page, pageCount, total }` (`pageCount ≥ 1`); with `before`: unchanged shape plus same keys from the cursor list (`page: 1, pageCount: 1, total: debates.length`).
- [ ] Tests (each seeds listed+complete Debates with labels via `saveLabels`): category filter; tag filter (via `json_each`);
  model filter matches either Side's AI model and not a Custom Debater's self-reported model; `kind=batch`; q matches Motion
  words case-insensitively and Tags; `q='100%'` does not match `"1000 things"`; multi-word AND; page 2 returns the 21st item,
  `pageCount` correct; junk page → 1; unknown category ignored; Unlisted/running Debates never returned; `/api/tags` counts only listed complete.
- [ ] Implement with `ESCAPE '\'`, `ORDER BY completed_at DESC, id DESC`, count with the same WHERE.
- [ ] Run api tests → PASS. Commit `feat(api): search, filter and page the Debate feed`.

### Task 5: Backfill

**Files:** Modify `apps/api/src/app.ts`, `apps/api/src/db/debates.ts`; Test `apps/api/test/labels-backfill.test.ts`

**Interfaces:** `unlabelledDebates(db, limit): Promise<{ id: string; motion: string }[]>`; route
`POST /api/moderation/labels` → `{ labelled: number; remaining: number }`, labels up to 10, via the unmetered
model client and `labellerFor(catalog)`; 401/403 like other moderation routes.

- [ ] Tests: non-Moderator → 403; Moderator labels two unlabelled listed complete Debates, leaves an Unlisted one alone, `remaining` 0.
- [ ] Commit `feat(api): Moderators can label older Debates`.

### Task 6: Web feed

**Files:** Modify `apps/web/src/pages/index.astro`, `apps/web/src/lib/debate.ts`, `apps/web/src/i18n/en.ts`,
`apps/web/src/components/PageHead.astro` (noindex prop if missing); Create `apps/web/src/components/FeedFilters.astro`,
`apps/web/src/components/Pagination.astro`, `apps/web/src/components/DebateLabels.astro`; Test `apps/web/src/lib/debate.test.ts` (if present) and `apps/web/e2e/feed.spec.ts`

**Interfaces:** `feedHref(query: Partial<FeedQueryParams>, change: Partial<FeedQueryParams>): string` (drops empty values and resets
page unless page is changed); `pageList(page, pageCount): (number | 'gap')[]` (first, last, current ±1, gaps).

- [ ] Unit tests for `feedHref` and `pageList` (`pageList(5,10)` → `[1,'gap',4,5,6,'gap',10]`; `pageList(1,1)` → `[1]`).
- [ ] Feed: form (label-wrapped search input `type=search name=q`, Category select, model select from `/api/models` debaters, Slow checkbox, Search button), Category links (current one `aria-current="page"`), popular Tags, active filter chips with remove links, "N Debates" count, entries with `DebateLabels`, `Pagination` nav (`aria-label`), how-strip only on unfiltered page 1, `noindex` when `q` is set.
- [ ] Debate page: `DebateLabels` under the Motion with `AiLabel`.
- [ ] e2e: search for a Motion word narrows the list; clicking a Category link filters; axe passes on a filtered page.
- [ ] Run `pnpm check`, `pnpm --filter @debate-arena/web build`, `pnpm --filter @debate-arena/web e2e` → PASS. Commit `feat(web): search, filter, Categories, Tags and pages on the feed`.

### Task 7: Moderation button + docs

- [ ] `/moderation` gets a small island button calling `POST /api/moderation/labels` repeatedly until `remaining` is 0, showing progress. README "Moderation" section mentions it. Commit.
