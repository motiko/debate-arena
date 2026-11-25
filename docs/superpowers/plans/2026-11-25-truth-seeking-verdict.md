# Truth-Seeking Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Debate Arena's Verdict answer "does the Motion stand, on what this Debate showed?", with a confidence, a crux, checked claims and a three-Judge Panel from different model families, keep Rubric Scores as the measure of how each Side argued, label the Audience Result as persuasion, and let the run-debate skill swap Sides to test a Motion.

**Architecture:** The engine's Judge prompt and parser change to the new question and fields; each Judge's answer becomes a Ballot, and the Panel's Verdict is the majority of 1 or 3 Ballots. Verdicts stay JSON in `verdict_json` (no migration); the API normalises old rows. Web and CLI render the new fields. Skills mirror the platform.

**Tech Stack:** TypeScript engine (Vitest), Hono API on Workers + D1, Astro/Svelte web (Playwright e2e), CLI.

**Spec:** the user's vision in conversation (2026-11-25): "the judge decision is upholding a motion and the scores scoring arguments and presentation quality … my vision is for it to be a kind of objective truth seeking platform", approving all six proposals: (1) verdict on the Motion from the Debate's own arguments and evidence, not the Judge's priors; (2) confidence and crux; (3) fact-check of key claims; (4) panel of different model families with the split shown; (5) swap Sides; (6) Audience Result labelled as persuasion. Recorded as ADR 0008 in Task 6.

## Global Constraints

- A Verdict always names one Side (For = the Motion stands, Against = it falls); "unresolved" is expressed as confidence `narrow`, never as a draw (GLOSSARY: never a draw).
- The Judge decides from the transcript; outside knowledge is used only to check factual claims, never to supply its own view of the Motion.
- Rubric Scores rate how each Side argued; they may favour the Side that lost. When they do, the reasoning names the deciding point.
- A Panel holds 1 or 3 distinct Judges. The default is 3 suggested Judges, preferring model families no AI Debater uses; fewer than 3 candidates → 1.
- Claim checks come from the Judge's own knowledge, unsourced, and say so wherever shown. At most 6 per Ballot; claim and note text capped at 300 characters each.
- All model output is untrusted: names of criteria come from the Rubric, enums are whitelisted, strings are length-capped, everything is rendered through Astro escaping.
- Old Verdicts (no confidence/crux/claims/ballots) keep rendering as today.
- Standard custom-vs-custom line-up stays at or under the daily Quota.

## Review Focus

1. A Judge reply with a valid winner but junk confidence/crux/claims: the Verdict must survive (confidence `narrow`, crux '', invalid claims dropped), not fail the Debate.
2. One Judge of three fails entirely: the remaining two decide; a 1–1 tie goes to the more confident Ballot, then Panel order.
3. Claims or crux containing HTML or very long text: escaped and capped.
4. Old stored Verdicts with none of the new fields: page, feed and CLI render without errors.
5. Mobile 360px: the panel split, claims list and ballots fit without horizontal scroll.

---

### Task 1: The Judge asks whether the Motion stands, with confidence, crux and claim checks

**Files:** Modify `packages/engine/src/domain.ts`, `packages/engine/src/judging/judge.ts`, `packages/engine/src/index.ts` (exports); Test `packages/engine/src/judging/judge.test.ts`, `packages/engine/src/budget/estimate.test.ts`.

**Interfaces — Produces:**
```ts
export type Confidence = 'clear' | 'likely' | 'narrow';
export type ClaimStatus = 'supported' | 'disputed' | 'false';
export interface ClaimCheck { side: Side; claim: string; status: ClaimStatus; note: string }
export interface Ballot { judge: ModelId; winner: Side; confidence: Confidence; reasoning: string; crux: string; scores: RubricScore[]; claims: ClaimCheck[] }
export interface Verdict { winner: Side; reasoning: string; scores: RubricScore[]; judges: ModelId[];
  confidence: Confidence | null; crux: string; claims: ClaimCheck[]; ballots: Ballot[] }
parseVerdict(text, rubric): { winner; reasoning; scores: RubricScore[] | null; confidence: Confidence; crux: string; claims: ClaimCheck[] } | null
JUDGE_OUTPUT_TOKENS = 1600; MAX_CLAIMS = 6; MAX_CLAIM_CHARS = 300
```

- [ ] Tests first (`judge.test.ts`): prompt asks whether the Motion stands on the Debate's own arguments and evidence, says Rubric Scores rate how each Side argued and may favour the losing Side, asks for confidence/crux/claims; parses all fields; invalid confidence → `narrow`; missing crux → ''; claims with bad side/status or non-string text dropped; claims beyond 6 dropped; claim/note cut to 300 chars; crux cut to 300 chars. Run, watch fail.
- [ ] Implement. JSON shape: `{"scores": …, "claims": [{"side": "for"|"against", "claim": "…", "status": "supported"|"disputed"|"false", "note": "…"}], "crux": "…", "winner": "for"|"against", "confidence": "clear"|"likely"|"narrow", "reasoning": "…"}`. askJudge returns a Ballot-shaped value (without judge). Raise `JUDGE_OUTPUT_TOKENS` and update pinned Budget numbers.
- [ ] `pnpm --filter @debate-arena/engine test` green; commit `feat(engine): the Judge decides whether the Motion stands, with a confidence, a crux and claim checks`.

### Task 2: A Panel of three Judges decides by majority

**Files:** Modify `packages/engine/src/judging/panel.ts`, `judge.ts`; Test `panel.test.ts`, `judge.test.ts`, `packages/engine/src/index.test.ts`.

**Interfaces — Produces:** `suggestPanel(debaters, candidates, size = 3): ModelId[]` (distinct; prefers families no AI Debater uses, then unused models; returns 1 when fewer than 3 candidates); `validatePanel(panel)` accepts 1 or 3 distinct; `judgeDebate` asks all Judges in parallel and returns `{...lead, judges, ballots}` where lead = first Ballot (Panel order) on the majority Side.

- [ ] Tests first: suggestPanel picks 3 distinct families avoiding Debaters' families; falls back to 1; validatePanel rejects 2, 4, duplicates; judgeDebate 2–1 majority with the lead's reasoning; one Judge failing → the two decide; 1–1 → higher confidence then Panel order; all fail → VerdictParseError. Watch fail.
- [ ] Implement; commit `feat(engine): a Panel of three Judges from different model families decides by majority`.

### Task 3: The API seats three Judges and serves the new Verdict

**Files:** Modify `apps/api/src/debates/start.ts`, `apps/api/src/app.ts` (publicView), `apps/api/src/models/factory.ts`; Test `apps/api/test/plan.test.ts`, `factory.test.ts`, related fixtures.

- [ ] Tests first: default plan seats 3 distinct Judges when the catalog suggests 3; a given panel of 3 accepted, 2 rejected ("A Panel must hold one or three Judges"); standard custom line-up's Quota ≤ daily; an old Verdict is served with `confidence: null, crux: '', claims: [], ballots: []`; fake Judge returns confidence, crux and one claim. Watch fail.
- [ ] Implement; update pinned Budget/Quota numbers (Ruling if the standard line-up's Quota rises). Commit `feat(api): Debates seat a three-Judge Panel and serve the Verdict's confidence, crux, claims and Ballots`.

### Task 4: The Debate page shows whether the Motion stands, how sure, the crux, checked claims and the Panel's split; the Audience Result is labelled persuasion

**Files:** Modify `apps/web/src/components/VerdictView.astro`, `DebateOutcome.astro`, `AudienceResultView.astro`, `apps/web/src/lib/debate.ts` (outcome judge line), `apps/web/src/i18n/en.ts`, `StartDebateForm.svelte` (platform choice says three Judges); Test `apps/web/e2e/pages.spec.ts`, web unit tests.

- [ ] Tests first (e2e on the fake Judge): the Verdict heading says "The Motion stands" or "The Motion falls" with the confidence word ("Clear", "Likely", "Too close to call"); a "Crux" line; a "Claims checked" list with status words and the note "Checked against the Judges' own knowledge, without sources"; "Panel: 3–0" (or split) with each other Ballot's reasoning in a `<details>`; the Audience Result says it measures persuasion, not who is right; all fits at 360px. Old Verdict (no new fields) still renders. Watch fail.
- [ ] Implement with scoped CSS; commit `feat(web): the Verdict says whether the Motion stands, how sure, the crux, checked claims and the Panel's split`.

### Task 5: The CLI prints the new Verdict

**Files:** Modify `packages/cli/src/render.ts`, `run.ts` help text; Test `render.test.ts`.

- [ ] Tests first: `renderVerdict` prints "Verdict: the Motion stands (For), clear — Panel 2–1 (a, b, c)", a "Crux:" line, one line per claim `  [false] For: <claim> — <note>`; old Verdict prints as before. Watch fail; implement; commit `feat(cli): the Verdict prints whether the Motion stands, its confidence, crux, claims and Panel split`.

### Task 6: Docs and skills

**Files:** Create `docs/adr/0008-verdict-decides-whether-the-motion-stands.md`; modify `GLOSSARY.md` (Judge, Panel, Verdict, Audience Result; new Confidence, Crux, Claim Check, Ballot), `.claude/skills/debate-judge/SKILL.md`, `.claude/agents/judge.md`, `.claude/skills/run-debate/SKILL.md` (summary uses the new fields; new `swap` option runs a rematch with the Debaters swapped and compares), `.claude/skills/debate-voter/SKILL.md` if it frames the vote as "who won".

- [ ] Write; `pnpm check` green; commit `docs: the Verdict decides whether the Motion stands (ADR 0008), and the skills follow`.
