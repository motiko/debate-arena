# AI Voter Count, Per-Model Votes and a Shared Audience Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Member chooses how many AI Voters a Debate has (with the cost shown as they drag), every AI Voter's before/after vote is kept and returned by the API, and the AI Audience Result is shown in the same panel format as the human Audience Result, side by side.

**Architecture:** The engine's `AiAudienceResult` gains the per-voter votes, so they are stored inside the existing `ai_audience_json` column (no migration) and flow unchanged through the API, the live `complete` event and the CLI. `aiVoters` in the start/quote body becomes a count (booleans stay accepted). The quote also returns what the AI Voters add to the worst-case Budget, which the start page shows next to a range slider. `AudienceResultView.astro` becomes a shared panel used for both audiences.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers (D1), Svelte 5 islands in Astro, Vitest (+ `@cloudflare/vitest-pool-workers`), Playwright e2e, Node CLI.

**Spec:** the decisions agreed in chat on 2026-11-16, restated here:
1. Show what AI Voters cost per model (answered in chat; the start page now shows the cost of the chosen count).
2. The AI Voter setting carries a number: how many AI Voters the Member wants. No fixed small range: a drag bar (slider) with the potential cost shown next to it.
3. AI votes are shown the same way as the human Audience votes: the same panel format (chart, wording, timing), side by side, still labelled AI. Never merged into the human result (GLOSSARY: AI Audience Result is "never merged").
4. Through the API, one can see how each model voted (before and after).

## Global Constraints

- Body field stays `aiVoters`. Accepted: `false`, `true` (= `AI_VOTER_COUNT`, 10, today's behaviour), or an integer `0 … MAX_AI_VOTERS`. `0` means none.
- `MAX_AI_VOTERS = 100`, in `apps/api/src/models/catalog.ts`. Why a ceiling at all: a Member with unlimited Quota pays nothing, and each voter makes up to 4 provider calls (2 stances × `MAX_ATTEMPTS` 2) in one step; 100 voters stays well inside a Worker's 1,000-subrequest limit. Regular Members are bounded earlier by the 24-point daily Quota.
- Error copy: `aiVoters must be true, false or a whole number from 0 to 100`.
- Votes are listed for counted voters only (both stances parsed), in voter order. Dropped voters stay in `dropped`.
- Old stored results have no `votes`; the API returns `votes: []` for them.
- AI content keeps its label (`<AiLabel />`), as everywhere (ADR 0005).
- Each task ends green on `pnpm check`; the branch ships through a PR (big change, per the delivery workflow), not `pnpm ship`.

## Review Focus

1. A Member with unlimited Quota sends `aiVoters: 5000` → 400 with the error copy, nothing charged or created. (Task 2 test.)
2. `aiVoters: 2.5`, `-1`, `"10"` → the same 400. (Task 2 test.)
3. A stored Debate completed before this change (no `votes` in its JSON) → `GET /api/debates/:id` returns `aiAudience.votes: []`, not a crash or a missing field. (Task 2 test.)
4. A voter that gives garbage is dropped and absent from `votes`, and `counted` equals `votes.length`. (Task 1 test.)
5. Dragging the slider fires many quotes; only the last answer's cost shows (the form already drops stale quotes by sequence). (Task 4 test.)

---

### Task 1: Engine — keep each AI Voter's votes

**Files:**
- Modify: `packages/engine/src/voting/ai-voter.ts`
- Modify: `packages/engine/src/index.ts` (export `AiVote`)
- Test: `packages/engine/src/voting/ai-voter.test.ts`

**Interfaces:**
- Produces: `export interface AiVote { model: ModelId; before: Stance; after: Stance }` and `AiAudienceResult extends OxfordResult { dropped: string[]; votes: AiVote[] }`. `runAiAudience` signature unchanged.

- [ ] **Step 1: Write the failing test** `runAiAudience lists each counted voter's model and votes, in voter order`: three voters `['a/x', 'b/y', 'c/z']` with a fake client where `b/y` answers garbage. Assert `result.votes` equals `[{ model: 'a/x', before, after }, { model: 'c/z', before, after }]` with the stances the fake returns, `result.dropped` equals `['1:b/y']`, and `result.counted === result.votes.length`.
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/engine exec vitest run src/voting/ai-voter.test.ts`. Expected: FAIL (`votes` undefined).
- [ ] **Step 3: Implement**: in `runAiAudience`, map the fulfilled values to `{ model, before, after }` (carry `model` alongside `voterId`) and return them as `votes`. Export `AiVote` from the package index.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm --filter @debate-arena/engine test` passes.
- [ ] **Step 5: Commit** `feat(engine): the AI Audience Result keeps each AI Voter's votes`.

### Task 2: API — a voter count, its cost in the quote, votes in the view

**Files:**
- Modify: `apps/api/src/models/catalog.ts` (add `export const MAX_AI_VOTERS = 100`)
- Modify: `apps/api/src/debates/start.ts` (parse, plan, quote)
- Modify: `apps/api/src/app.ts` (`publicView`/`debateView`: normalise `votes`; quote response)
- Test: `apps/api/test/plan.test.ts`, `apps/api/test/routes.test.ts`, `apps/api/test/db-debates.test.ts` (or wherever `publicView` of a stored result is easiest to hit)

**Interfaces:**
- Consumes: `AiVote`, `AiAudienceResult.votes` (Task 1).
- Produces: `StartDebateInput.aiVoters: number` (parsed count). `PlanResult` ok-branch gains `aiVotersMicroUsd: number` = worst case with the voters minus worst case without them (0 when none). `POST /api/debates/quote` JSON gains `aiVotersMicroUsd`. Public `aiAudience` is `AiAudienceResult` with `votes` always present.

- [ ] **Step 1: Write the failing tests**
  - `plan.test.ts` `aiVoters as a count picks that many AI Voters`: `planDebate` with `aiVoters: 3` → `aiVoters.length === 3`; with `true` → 10; with `0` and `false` → 0 and `aiVotersMicroUsd === 0`.
  - `plan.test.ts` `aiVotersMicroUsd is what the AI Voters add to the Budget`: for `aiVoters: 4`, `aiVotersMicroUsd === worstCaseBudgetMicroUsd(setup, voters, prices, screener) - worstCaseBudgetMicroUsd(setup, [], prices, screener)` and `> 0`.
  - `routes.test.ts` `an AI Voter count out of range or not whole is refused` (Review Focus 1–2): for each of `5000, 101, -1, 2.5, '10'`, `POST /api/debates` and `/api/debates/quote` answer 400 with `aiVoters must be true, false or a whole number from 0 to 100`; no Debate row and no Quota spent (use a regular member for one case and an unlimited one for `5000`).
  - `routes.test.ts` `the quote reports what the AI Voters add`: quote with `aiVoters: 2` returns a positive `aiVotersMicroUsd`; with `false`, `0`.
  - `stored AI Audience Result without votes is served with votes: []` (Review Focus 3): insert/complete a Debate whose `ai_audience_json` is `{"counted":0,"swing":{"for":0,"against":0},"winner":"tie","dropped":[]}`; `GET /api/debates/:id` → `aiAudience.votes` equals `[]`.
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/api exec vitest run test/plan.test.ts test/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - `parseStartInput`: `aiVoters` → `true` ⇒ `AI_VOTER_COUNT`, `false`/absent ⇒ 0, integer in `0…MAX_AI_VOTERS` ⇒ itself, anything else ⇒ the error copy. `StartDebateInput.aiVoters` becomes `number`.
  - `planDebate`: `pickAiVoters(catalog, parsed.aiVoters)`; compute `aiVotersMicroUsd` as above; the over-quota message keeps saying "or fewer AI Voters" instead of "or leave out AI Voters".
  - Quote route returns `aiVotersMicroUsd`.
  - View: `aiAudience: d.aiAudience && { ...d.aiAudience, votes: d.aiAudience.votes ?? [] }`.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @debate-arena/api test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): choose how many AI Voters; the quote prices them; each AI Voter's votes in the Debate view`.

### Task 3: CLI — `--ai-voters <n>` and per-model votes in `show`

**Files:**
- Modify: `packages/cli/src/run.ts` (option, usage text, body)
- Modify: `packages/cli/src/render.ts` (`renderAiAudience`)
- Modify: `.claude/skills/run-debate/SKILL.md` (the optional flags line: `--ai-voters <n>`)
- Test: `packages/cli/src/run.test.ts`, `packages/cli/src/render.test.ts`

**Interfaces:**
- Consumes: quote/start accept `aiVoters: number`; `aiAudience.votes` (Task 2).

- [ ] **Step 1: Write the failing tests**
  - `start --ai-voters 3 sends aiVoters: 3`; `start --ai-voters x` exits 2 with usage (not a request).
  - `renderAiAudience lists each AI Voter's model and votes`: given votes `[{ model: 'a/x', before: 'undecided', after: 'for' }]`, output contains the line `a/x: Undecided → For`.
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/cli exec vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement**: `'ai-voters': { type: 'string' }`, parsed with `/^\d+$/` else `usageError`; usage line `[--ai-voters <n>]` with description "How many AI Voters (0–100)". `renderAiAudience` appends one line per vote after the existing summary, using the existing side/stance labels.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): --ai-voters takes a count; show lists each AI Voter's votes`.

### Task 4: Start page — a slider for the count, with its cost beside it

**Files:**
- Modify: `apps/web/src/islands/StartDebateForm.svelte`
- Modify: `apps/web/src/i18n/en.ts`
- Test: `apps/web/test/start-debate-form.test.ts`

**Interfaces:**
- Consumes: quote JSON `aiVotersMicroUsd` (Task 2).

- [ ] **Step 1: Write the failing tests**
  - `checking AI Voters shows a slider at 10 and sends the count`: after clicking the "Add AI Voters" checkbox, `getByRole('slider', { name: 'AI Voters' })` has value `10`; changing it to `25` and submitting sends `aiVoters: 25`. Unchecked sends `aiVoters: false` (existing test at line 60 changes from `true` to `10`).
  - `the slider shows what its AI Voters cost`: with a quote fetcher answering `aiVotersMicroUsd: 90000`, the text `25 AI Voters · up to $0.09` is shown next to the slider (Review Focus 5: fire two quotes, the stale one answering later with `40000` must not replace it).
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/web exec vitest run test/start-debate-form.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: `let aiVoterCount = $state(10)`; body sends `aiVoters: aiVoters ? aiVoterCount : false`; under the checkbox, when checked, `<input type="range" min="1" max="100" step="1" aria-label="AI Voters">` bound to `aiVoterCount` and an `<output>` with `new.aiVotersCount`. Keep `aiVotersMicroUsd` from the quote in state beside `quotaPoints`. Copy:
  - `'new.aiVotersHint': 'AI models vote before and after, shown as a separate AI Audience Result.'`
  - `'new.aiVotersCount': '{count} AI Voters · up to ${usd}'` (usd = `(micro / 1e6).toFixed(2)`, `'…'` while no quote)
  - `'new.summaryAiVoters': 'with {count} AI Voters'`
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): choose how many AI Voters with a slider that shows their cost`.

### Task 5: Debate page — the AI Audience Result in the same panel as the Audience Result

**Files:**
- Modify: `apps/web/src/components/AudienceResultView.astro` (becomes the shared panel)
- Modify: `apps/web/src/components/DebateOutcome.astro:71-82` (use it for both, side by side)
- Modify: `GLOSSARY.md` (AI Voter: "its starting Member opts in and chooses how many; the platform chooses which models")
- Test: `apps/web/e2e/pages.spec.ts` (the existing AI-voters Debate at line 39)

**Interfaces:**
- `AudienceResultView` props: `{ title: string; ai?: boolean; result: OxfordResult & { votingClosesAt?: string | null }; voters: 'members' | 'aiVoters'; myVote?: PublicDebate['myVote']; notes?: string[] }`. Human: `title=t('audience.title')`, `voters='members'`, `myVote`, closing date. AI: `title=t('aiAudience.title')`, `ai`, `voters='aiVoters'`, `notes` = the voter-models line, the shared-model note and the dropped note (as today).

- [ ] **Step 1: Write the failing e2e test** `the AI Audience Result sits beside the Audience Result in the same panel`: on a completed Debate with AI Voters, `page.locator('.audiences > section.division')` has count 2, the second has heading `AI Audience Result` with the AI label, and both contain a swing chart (`[data-swing]` or the chart's existing selector).
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/web e2e -g "beside the Audience Result"`. Expected: FAIL.
- [ ] **Step 3: Implement**: generalise the panel per the props above; in `DebateOutcome`, wrap both in `<div class="audiences">` (CSS grid, two equal columns from 48rem, one column below; Slow Debates show only the AI panel). Delete the old `.ai-audience` section and its styles.
- [ ] **Step 4: Run** the same e2e test, then `pnpm --filter @debate-arena/web e2e` (axe checks included). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the AI Audience Result in the Audience Result's panel, side by side`.

### Task 6: Whole-branch check and PR

- [ ] **Step 1:** `pnpm check && pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e`. Expected: all green.
- [ ] **Step 2:** Push the branch and open a PR titled `AI Voter count, per-model votes, shared audience panel`, body listing the four spec points and the `MAX_AI_VOTERS` rationale.
