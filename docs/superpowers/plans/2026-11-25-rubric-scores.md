# Rubric Scores on the Verdict — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Judge scores each Side 1–10 on every Rubric criterion along with its Verdict, and Viewers see the Rubric and those scores on the Debate page and in the CLI.

**Architecture:** The engine's `Verdict` gains `scores: RubricScore[]`, parsed from the Judge's JSON reply and stored inside the existing `verdict_json` column (no migration). The API adds the Rubric to the public `format` and returns `scores: []` for Verdicts stored before this change. `VerdictView.astro` shows a scores table under the winner, with each criterion's description, and the CLI prints one line per criterion.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers (D1), Astro + Svelte 5, Vitest, Playwright e2e, Node CLI.

**Spec:** agreed in chat on 2026-11-25. The Judge already scores against a four-criterion Rubric (`packages/engine/src/formats/classic.ts`), but it is asked only for `winner` and `reasoning`, and Viewers never see the Rubric. The change:
1. Ask the Judge for a 1–10 score per criterion per Side, as well as its winner and reasoning. The winner stays the Judge's explicit choice, never derived from the scores.
2. Store the scores with the Verdict. Old Debates have none and show none.
3. Show the scores on the Debate page (a small table, with each criterion's description) and in the CLI.
4. Show the Rubric while the Debate runs, next to "The Judge gives the Verdict when the Debate ends."

## Global Constraints

- Domain terms follow GLOSSARY.md. New term **Rubric Score**: "A Judge's mark from 1 to 10 for one Side on one Rubric criterion, given with the Verdict. The winner is the Judge's own decision, not the sum of the Rubric Scores." _Avoid_: rating, points, grade. Add it with the domain-modeling skill. The Verdict entry ("_Avoid_: … score") stays: a Verdict is not a score; it carries Rubric Scores.
- Scores are integers 1–10. One entry per Rubric criterion, in Rubric order, keyed by the criterion's `name`.
- Judge reply shape: `{"scores": {"<criterion name>": {"for": <1-10>, "against": <1-10>}, …}, "winner": "for" | "against", "reasoning": "<a few sentences>"}`.
- Scores never block a Verdict: a reply with a valid winner and reasoning but bad scores is retried like an unparseable one, and if no attempt yields valid scores, the last valid winner and reasoning are kept with `scores: []` (same pattern as the wrong-language fallback). A finished Debate must never fail over scores.
- `JUDGE_OUTPUT_TOKENS` goes from 800 to 1000. It feeds the Budget estimate (`packages/engine/src/budget/estimate.ts`), so the worst-case cost of a Judge rises slightly. That is accepted.
- No total and no "winner by points" is shown: only per-criterion scores, so a split between scores and winner is not presented as a contradiction.
- AI content keeps its label: the scores sit inside the Verdict section, which already carries `<AiLabel />`.
- Copy (en.ts): `verdict.scores` = `Rubric Scores`, `verdict.criterion` = `Criterion`, `verdict.rubric` = `The Judge scores each Side on: {criteria}.`
- Each task ends green on `pnpm check`. The branch ships through a PR (a big change, per the delivery workflow), not `pnpm ship`.

## Review Focus

1. A Judge reply whose scores are strings (`"7"`), fractions (`7.5`), out of range (`0`, `11`), missing a criterion, or a huge nested object → those scores are rejected (no crash, no throw), and the Verdict still lands with `scores: []` at worst. (Task 1 tests.)
2. A Verdict stored before this change (JSON without `scores`) → `GET /api/debates/:id` returns `verdict.scores: []`, and the page renders without the table. (Task 2 and Task 3 tests.)
3. Criterion names in the reply are model output: unknown extra keys are ignored, and only the Rubric's own names (from the Format, not the reply) are ever rendered as labels. (Task 1 test.)
4. Scores that favour the loser (e.g. For's scores higher, winner Against) are accepted and shown as given, not "corrected". (Task 1 test.)
5. A narrow phone (360px): the scores table fits without horizontal page scroll. (Task 3: covered by the existing mobile e2e project running the Verdict test.)

---

### Task 1: Engine — the Judge returns Rubric Scores

**Files:**
- Modify: `packages/engine/src/domain.ts` (add `RubricScore`, extend `Verdict`)
- Modify: `packages/engine/src/judging/judge.ts`
- Modify: `packages/engine/src/index.ts` (export `RubricScore`)
- Modify: `apps/api/src/models/factory.ts` (fake Judge returns scores)
- Modify: `GLOSSARY.md` (Rubric Score)
- Test: `packages/engine/src/judging/judge.test.ts`, the factory's existing test if one covers the fake Judge

**Interfaces:**
- Produces: `export interface RubricScore { criterion: string; for: number; against: number }`; `Verdict { winner: Side; reasoning: string; scores: RubricScore[]; judges: ModelId[] }`; `parseVerdict(text: string, rubric: Rubric): { winner: Side; reasoning: string; scores: RubricScore[] | null } | null`, where `null` overall means no usable winner or reasoning, and `scores: null` means the winner and reasoning are fine but the scores are not. `JUDGE_OUTPUT_TOKENS = 1000`.

- [ ] **Step 1: Write the failing tests** in `judge.test.ts`:
  - `Judge prompt asks for a 1-10 score per Rubric criterion and Side`: the system message contains `"scores"`, `1 to 10`, and each criterion name.
  - `parses scores in Rubric order`: a reply listing the criteria in reverse order → `scores` equals the four `{ criterion, for, against }` in Rubric order (`Argument strength`, `Rebuttal quality`, `Evidence`, `Clarity`).
  - `bad scores are null, the winner and reasoning still parse`: for each of `"7"`, `7.5`, `0`, `11`, a missing criterion, `scores` absent, `scores: []` → `parseVerdict(...)` gives `{ winner, reasoning, scores: null }`.
  - `extra score keys are ignored`: a reply with the four criteria plus `"<script>": {...}` → four scores, no extra.
  - `scores may favour the losing Side`: all For scores 9, Against scores 3, winner `against` → kept as given.
  - `retries when the scores are bad, and keeps the first reply's Verdict with no scores if every attempt is bad`: a fake client answering a valid winner and reasoning with bad scores twice → `judgeDebate` resolves to `{ winner, reasoning, scores: [] }` with 2 calls.
  - `a good second reply's scores are used`: bad scores, then good → the good reply's scores, 2 calls.
  - Update the existing `parses plain and fenced JSON` / `rejects …` expectations to the new return shape.
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/engine exec vitest run src/judging/judge.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `buildJudgeMessages`, replace the JSON line with the reply shape from Global Constraints, plus: `Give each Side a whole number from 1 to 10 on every criterion. Your winner is your overall judgement.` In `parseVerdict`, take `rubric`, read `scores[c.name]` for each criterion, and accept only `Number.isInteger(v) && v >= 1 && v <= 10` for both Sides. In `askJudge`, treat `scores: null` like the wrong-language case: remember the Verdict, retry, and fall back to it with `scores: []`. Where both a language and a scores problem exist, keep the existing rewrite request for language; a fallback may have either problem. `judgeDebate` returns `scores`. Raise `JUDGE_OUTPUT_TOKENS` to 1000. The fake Judge in `factory.ts` returns scores for every criterion of the Classic Format's Rubric (import it from the engine), e.g. For 7/6/6/8 and Against 6/7/7/7. Add the GLOSSARY term.
- [ ] **Step 4: Run** the same command, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): the Judge gives a Rubric Score per criterion and Side with its Verdict`.

### Task 2: API — Rubric in the format, scores in the Verdict

**Files:**
- Modify: `apps/api/src/app.ts` (`publicView`)
- Test: the API test that reads `GET /api/debates/:id` of a stored Debate (where the `aiAudience.votes ?? []` case is tested; find it with `grep -rn "votes: \[\]" apps/api/test`)

**Interfaces:**
- Consumes: `Verdict.scores`, `Rubric` from Task 1.
- Produces: `PublicDebate.format.rubric: { criteria: { name: string; description: string }[] }`; `PublicDebate.verdict: (Verdict & { scores: RubricScore[] }) | null`, always with `scores` (`[]` for old Verdicts).

- [ ] **Step 1: Write the failing tests:** `a Debate's view includes its Format's Rubric` (`format.rubric.criteria` has the four names) and `a Verdict stored without scores is returned with scores: []` (insert a Debate whose `verdict_json` is `{"winner":"for","reasoning":"r","judges":["x/y"]}`).
- [ ] **Step 2: Run** the API test file. Expected: FAIL.
- [ ] **Step 3: Implement:** add `rubric: d.setup.format.rubric` to `format`, and `verdict: d.verdict && { ...d.verdict, scores: d.verdict.scores ?? [] }`, with a comment like the `aiAudience` one.
- [ ] **Step 4: Run** the test file, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): a Debate shows its Rubric, and its Verdict's Rubric Scores`.

### Task 3: Web — the scores table and the Rubric line

**Files:**
- Modify: `apps/web/src/components/VerdictView.astro` (table)
- Modify: `apps/web/src/components/DebateOutcome.astro` (pass `rubric`; Rubric line under the pending text)
- Modify: `apps/web/src/i18n/en.ts`
- Test: `apps/web/e2e/pages.spec.ts`

**Interfaces:**
- Consumes: `PublicDebate.format.rubric`, `PublicDebate.verdict.scores` (Task 2).
- `VerdictView` gains the prop `rubric: PublicDebate['format']['rubric']`.

- [ ] **Step 1: Write the failing e2e assertions:** in `debate page shows Turns, Verdict and AI labels`, after the Verdict heading: a table named `Rubric Scores` with column headers `Criterion`, `For`, `Against`, a row header `Argument strength` with the fake Judge's scores, and the text `Engages directly with the other Side's strongest points.` In the running-Debate test that sees `verdict.pending` (find it with `grep -n "Verdict when" apps/web/e2e`), assert `The Judge scores each Side on: Argument strength, Rebuttal quality, Evidence, Clarity.`
- [ ] **Step 2: Run** `pnpm --filter web exec playwright test e2e/pages.spec.ts` (use the package's own e2e script name if it differs). Expected: FAIL.
- [ ] **Step 3: Implement.** In `VerdictView`, after the reasoning and only when `verdict.scores.length > 0`, render a `<table>` with `<caption>` `Rubric Scores`, `<th scope="col">` for Criterion, For and Against, and one row per score: `<th scope="row">` with the criterion name, then its description from `rubric` (matched by name, as smaller muted text; omit it if no match), then the two numbers in `side-for` / `side-against` colours. Labels come from the Rubric where they match; the score's own name is shown otherwise (it was validated against the Rubric in Task 1). The table is `width: 100%`, the description wraps, and the numbers are `tabular-nums`, so it fits 360px. Use the existing tokens (`--brass`, `--surface`, `--font-serif`); no new colours. In `DebateOutcome`, pass `rubric={debate.format.rubric}` and add the `verdict.rubric` line under the pending text.
- [ ] **Step 4: Run** the e2e file (both desktop and mobile projects), then `pnpm check`. Expected: PASS. Look at the page once at phone width via the `run` skill, and fix anything that overflows.
- [ ] **Step 5: Commit** `feat(web): the Verdict shows the Judge's Rubric Scores, and a running Debate names its Rubric`.

### Task 4: CLI — print the scores

**Files:**
- Modify: `packages/cli/src/render.ts` (`renderVerdict`)
- Test: `packages/cli/src/render.test.ts`

**Interfaces:**
- Consumes: `PublicDebate['verdict']` with `scores` (Task 2). The live `verdict` event carries the engine `Verdict`, which has `scores` too.

- [ ] **Step 1: Write the failing tests:** `renderVerdict lists each Rubric Score` → the output contains `  Argument strength: For 7 · Against 6` for each score, between the `Verdict:` line and the reasoning; and `renderVerdict with no scores is unchanged` → equals today's output for `scores: []`.
- [ ] **Step 2: Run** `pnpm --filter @debate-arena/cli exec vitest run src/render.test.ts` (or the package's `node --test` runner if it uses one). Expected: FAIL.
- [ ] **Step 3: Implement** the lines in `renderVerdict`. Guard with `verdict.scores ?? []`, because a server not yet deployed returns no `scores`.
- [ ] **Step 4: Run** the test, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): the Verdict prints the Judge's Rubric Scores`.
