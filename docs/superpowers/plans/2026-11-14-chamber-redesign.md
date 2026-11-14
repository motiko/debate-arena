# Chamber Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page of the web app takes the "chamber" identity: a bench-green band, a self-hosted serif, facing benches and a floor line on the Debate page, and an outcome the reader earns.

**Architecture:** Only `apps/web` changes. New colour and type tokens replace the old ones in `global.css`. Debate-page logic (what the dispatch box shows, the outcome headline, motion size, swing bars) lives in pure helpers in `src/lib/debate.ts`, with unit tests. Astro components render the band, outcome and record. One Svelte `PhaseFloor` renders the Turns for both server pages and the live island.

**Tech Stack:** Astro 7.4 (Fonts API, local provider), Svelte 5 islands, Vitest + Testing Library, Playwright + axe, Lighthouse CI.

**Spec:** `docs/superpowers/specs/2026-11-14-chamber-redesign-design.md`

## Global Constraints

- Lighthouse on `/`, a Debate page and `/new` (mobile, slow 4G): performance ≥ 0.9, SEO 1, accessibility 1 (`pnpm --filter @debate-arena/web lighthouse`).
- axe passes on every page the e2e suite visits (`expectNoAxeViolations`); WCAG 2.2 AA; keyboard-only use works; `prefers-reduced-motion` stops the live marker's pulse.
- No third-party requests: the font is one vendored file, `apps/web/src/assets/fonts/source-serif-4-latin-wght-normal.woff2` (50,936 bytes, from `@fontsource-variable/source-serif-4@5.3.1`, OFL-1.1, licence copied as `OFL.txt` next to it).
- Every viewer-visible string comes from `src/i18n/en.ts`. New keys and their exact copy are listed in Task 2.
- Colour tokens and values are exactly the spec's table. No text pair falls below 4.5:1, and `--brass` is never used for text.
- No API, engine or data changes. Existing e2e flows keep passing. Selectors change only where this plan renames visible text, as listed per task.
- `pnpm check` passes after every task.

## Review Focus

- **A Motion of the maximum length.** A 300-character Motion with long words must neither overflow the band nor push the dispatch box off the phone screen. Test it in Task 4 (e2e at 390px: no horizontal scroll).
- **A Debate where the judge and the audience disagree.** It must say "Split decision" and never a single winner. Unit test in Task 2.
- **A Turn cut off at the word limit inside the collapsed view.** It must show the cut-off note without expanding. Unit test in Task 3.
- **Extreme swings.** A swing of 0 points, a 100-point swing, and a negative swing on both sides. Bars must stay inside the axis and the labels must stay readable. Unit test of `swingBars` in Task 5.
- **Dark mode.** The focus ring must stay visible on paper and on the band, and the side text must stay readable on solid bench colours. Covered by an e2e axe run with `colorScheme: 'dark'` in Task 9.

---

### Task 1: Tokens, font and the band header

**Files:**
- Create: `apps/web/src/assets/fonts/source-serif-4-latin-wght-normal.woff2`, `apps/web/src/assets/fonts/OFL.txt` (copy both from `npm pack @fontsource-variable/source-serif-4@5.3.1`: `files/source-serif-4-latin-wght-normal.woff2` and `LICENSE`)
- Create: `docs/adr/0007-self-hosted-reading-font.md`
- Modify: `apps/web/astro.config.mjs` (add `fonts`)
- Modify: `apps/web/src/styles/global.css` (replace the tokens and base rules; keep `.skip-link`, `.visually-hidden`, form and button rules restyled)
- Modify: `apps/web/src/layouts/Base.astro`, `apps/web/src/components/Header.astro`
- Test: `apps/web/e2e/pages.spec.ts`

**Interfaces:**
- Produces: CSS custom properties from the spec table (`--paper`, `--surface`, `--ink`, `--muted`, `--line`, `--green`, `--band`, `--band-ink`, `--band-muted`, `--for`, `--against`, `--on-side`, `--brass`, `--for-tint`, `--against-tint`, `--note-bg`, `--note-text`, `--focus`) and `--font-serif`. The dark values come under `@media (prefers-color-scheme: dark)`.
- Produces: `Base.astro` takes an optional named slot `band`. Its content renders inside the band, below the header and inside `.wrap-wide`. The page body goes in `<main>` as now. Layout widths: `--measure: 42rem` (reading), `--wide: 73.75rem` (band and floor). Utility classes: `.wrap` (measure) and `.wrap-wide`.
- Produces: the classes `.serif` (font-family `var(--font-serif)`) and `.lozenge` (an inline brass square rotated 45°, sized by `--size`, default 0.75rem, `aria-hidden` by its users).

- [ ] **Step 1: Write the failing e2e tests** in `pages.spec.ts`:
  - `test('the page loads its serif from this site only')`: on `/`, collect every request URL. Expect each URL's origin to equal `page.url()`'s origin. Expect `await page.evaluate(() => document.fonts.check('600 1rem "Source Serif 4"'))` to be `true` after `document.fonts.ready`.
  - `test('the header sits in the green band')`: on `/`, expect the computed `background-color` of `.site-header` to be `rgb(29, 92, 69)`.
- [ ] **Step 2:** Run `pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e pages.spec.ts`. Expected: both new tests FAIL.
- [ ] **Step 3: Add the font.**
  - In `astro.config.mjs`, add `fonts: [{ provider: fontProviders.local(), name: 'Source Serif 4', cssVariable: '--font-serif', fallbacks: ['Georgia', 'serif'], options: { variants: [{ src: ['./src/assets/fonts/source-serif-4-latin-wght-normal.woff2'], weight: '200 900', style: 'normal' }] } }]`. The file goes in `src/`, not `public/`, so Astro emits it once.
  - In `Base.astro`'s `<head>`, add `<Font cssVariable="--font-serif" preload />` (from `astro:assets`).
  - Update `theme-color` to `#1D5C45` (light) and `#173A2C` (dark).
- [ ] **Step 4: Rewrite `global.css`.** Build it from the tokens, under these rules:
  - `body`: background `--paper`, colour `--ink`.
  - `h1, h2, h3`: `--font-serif`, weight 600.
  - Links: `--green`.
  - Focus ring: `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }`, with `--focus: var(--ink)` on `:root` and `--focus: var(--band-ink)` on `.band`.
  - Buttons: filled `--green` with `--paper` text. `.secondary` is outlined.
  - Inputs: `--surface` background with a `--muted` border.
  - Replace the header comment "System fonts only…" with "One self-hosted serif (ADR 0007); everything else uses system fonts."
- [ ] **Step 5: Restyle `Base.astro` and `Header.astro`.**
  - A `<div class="band">` holds the `<header class="site-header">`, then `<slot name="band" />`.
  - The brand gets `<span class="lozenge" aria-hidden="true">` before `t('site.name')`, set in serif.
  - Nav links and quota use `--band-ink` / `--band-muted`.
  - The footer keeps its structure on `--paper` with a `--line` top rule.
- [ ] **Step 6: Write ADR 0007.** Use the domain-modeling skill's ADR format. It records:
  - **Decision:** one self-hosted variable latin file, preloaded, with a metric-adjusted fallback from Astro's Fonts API.
  - **Why:** reading quality of long speeches.
  - **Cost:** 50.9 KB, one same-origin request.
  - **Rejected:** Google Fonts (ADR 0005), and the opsz file (122 KB).
- [ ] **Step 7:** Run `pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e pages.spec.ts legal.spec.ts`. Expected: PASS, axe included.
- [ ] **Step 8:** Commit: `feat(web): chamber tokens, self-hosted serif, band header`

### Task 2: Debate view helpers and copy

**Files:**
- Modify: `apps/web/src/lib/debate.ts`, `apps/web/src/i18n/en.ts`
- Test: `apps/web/test/debate.test.ts`

**Interfaces:**
- Produces, all in `src/lib/debate.ts`:
  - `type MotionSize = 'l' | 'm' | 's'`; `motionSize(text: string): MotionSize`. Up to 120 characters is `l`; 121–200 is `m`; longer is `s`.
  - `type DispatchState = 'ask' | 'generating' | 'live' | 'judgingFailed' | 'failed' | 'revealed' | 'hidden'`;
    `dispatchState(d: { kind: 'live' | 'batch'; status: 'running' | 'complete' | 'failed'; turnsHidden: boolean; turns: unknown[]; myVote: { before: unknown; after: unknown } | null; audienceResult: { votingClosesAt: string | null } }, now?: number): DispatchState`.
    It applies the spec's table in order: `turnsHidden` → `ask`; batch + not complete → `generating`; running → `live`; failed with Turns → `judgingFailed`; failed → `failed`; complete live Debate whose `myVote?.after` is set or whose voting is closed (`votingClosesAt <= now`) → `revealed`; otherwise → `hidden`.
  - `interface Outcome { headline: string; judge: string; audience: string | null; split: boolean }`;
    `outcome(d: { kind: 'live' | 'batch'; debaters: { for: Debater; against: Debater }; verdict: { winner: Side } | null; audienceResult: OxfordResult }, models: ModelInfo[]): Outcome | null`. It returns null without a Verdict. `split` is true when it is a live Debate, `audienceResult.counted > 0`, the audience winner is not `'tie'`, and the audience winner ≠ `verdict.winner`. `audience` is null for batch.
  - `spokeCount(turns: Pick<Turn, 'side'>[], side: Side): number`.
  - `debaterLabel(d: Debater, models: ModelInfo[]): string`. It lifts the page's existing inline `debater()` helper.
- Produces the i18n keys (exact copy):
  - `'band.motion': 'The Motion before the house'`
  - `'band.forBench': 'For the Motion'`, `'band.againstBench': 'Against the Motion'`
  - `'band.spoke': 'Spoke {count} times'`
  - `'dispatch.ask': 'Where do you stand?'`
  - `'dispatch.generating': 'Being argued through batch processing. Published when complete.'`
  - `'dispatch.live': 'Live now'`, `'dispatch.follow': 'Follow the speeches below.'`
  - `'dispatch.judgingFailed': 'Judging failed. The speeches are below; there is no Verdict.'`
  - `'dispatch.show': 'Show the result'`
  - `'outcome.carries': '{model} carries the Motion'`, `'outcome.defeats': '{model} defeats the Motion'`
  - `'outcome.split': 'Split decision'`
  - `'outcome.judge': 'Judge: {side}'`
  - `'outcome.audience': 'Audience: {side}, {points} points'`, `'outcome.audienceTied': 'Audience: tied'`, `'outcome.audienceNone': 'Audience: no paired votes yet'`
  - `'floor.words': '{count} words'`
  - `'floor.speaker': '{model}, {side}'`
  - `'floor.next': '{side} speaks next'`
  - `'floor.more': 'Read the full speech'`
  - `'verdict.side': '{side}: {model}'`
  - `'record.title': 'Record of this Debate'`, `'record.format': 'Format'`, `'record.judge': 'Judge'`, `'record.started': 'Started'`, `'record.finished': 'Finished'`, `'record.kind': 'Kind'`
  - `'record.picked': '{judges}, picked by the platform'`, `'record.chosen': '{judges}, chosen by the starter'`
  - `'record.review': 'A moderator reviews every report.'`
  - `'share.copy': 'Copy link to this Debate'`, `'share.copied': 'Link copied.'`, `'share.manual': 'Copy this link:'`
  - `'feed.carried': 'Carried'`, `'feed.defeated': 'Defeated'`, `'feed.sides': '{for} for, {against} against'`
  - `verdict.winner` and `debate.motion` are removed if no longer used (`pnpm typecheck` finds leftovers).
  - The Record's Judge row uses `record.picked` / `record.chosen`. The Debate's `panel` alone can't tell them apart, so the page uses `record.picked` until the API exposes who chose. That stays, because the API is out of scope.

- [ ] **Step 1: Write the failing tests** in `debate.test.ts`:
  - `motionSize`: 120 characters → `'l'`, 121 → `'m'`, 200 → `'m'`, 201 → `'s'`.
  - `dispatchState` order, one case per row of the spec's table. Include:
    - a complete live Debate with `myVote: { before: 'for', after: null }` and open voting → `'hidden'`;
    - the same with `after: 'for'` → `'revealed'`;
    - closed voting and no vote → `'revealed'`;
    - a complete batch Debate → `'hidden'`.
  - `outcome`:
    - Verdict For with audience winner For → headline `'Fake A carries the Motion'`, `split` false, audience `'Audience: For, +13 points'` (swing.for 13). Use the same signed formatting as `swingText`, sharing its existing `signed` helper.
    - Verdict Against with audience For (counted 4) → headline `'Split decision'`, `split` true.
    - Audience `counted: 0` → audience `'Audience: no paired votes yet'`, not split.
    - Batch → audience null.
    - No Verdict → null.
  - `spokeCount` on a For/Against/For list → 2 and 1.
- [ ] **Step 2:** Run `pnpm --filter @debate-arena/web test debate.test.ts`. Expected: FAIL (the functions don't exist yet).
- [ ] **Step 3:** Implement the functions and add the keys in `en.ts`.
- [ ] **Step 4:** Run `pnpm --filter @debate-arena/web test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): debate view helpers for the chamber`

### Task 3: The floor (phases and speeches)

**Files:**
- Create: `apps/web/src/islands/PhaseFloor.svelte`
- Modify: `apps/web/src/islands/TurnItem.svelte`, `apps/web/src/islands/LiveTurns.svelte`
- Test: `apps/web/test/turn-item.test.ts`, `apps/web/test/phase-floor.test.ts` (new), `apps/web/test/live-turns.test.ts`

**Interfaces:**
- Produces `TurnItem` props: `{ phase: string; speaker: string; side: Side; text: string; truncated: boolean }`.
  - The heading is an `h3`. Its text is `<span class="visually-hidden">{phase}: </span>{t('floor.speaker', { model: speaker, side: sideLabel(side) })}`, followed by the AI label.
  - The first two `paragraphs(text)` render directly. The rest go inside `<details class="more"><summary>{t('floor.more')}</summary>…</details>`.
  - When `truncated`, the cut-off note renders after the details, always visible.
  - Class `speech speech-{side}`.
- Produces `PhaseFloor` props: `{ format: { phases: { name: string; order: Side[]; maxWords: number }[] }; turns: Turn[]; speakers: Record<Side, string>; next?: TurnSlot | null }`.
  - It renders one `<section class="phase" aria-labelledby>` per phase that has Turns, or is the phase of `next`.
  - Each section has an `h2` (phase name) with `<span class="limit">{t('floor.words', { count: maxWords })}</span>` inside it, then its Turns as `TurnItem`.
  - When `next` is set, a placeholder `<p class="next next-{side}">` holds a `<span class="live-dot" aria-hidden="true">` and `t('floor.next', { side })`, in `next`'s phase.
  - The floor line is a `::before` on the wrapping `.floor` element.
  - Desktop (≥ 48rem): a grid of `minmax(0,1fr) 7.5rem minmax(0,1fr)`. For speeches go in column 1, Against speeches in column 3 with `margin-top: 5rem`, and the phase heading is centred in column 2.
  - Phone: a single column, with For given `margin-right: 1.75rem` and Against `margin-left: 1.75rem`.
- Consumes: `paragraphs`, `sideLabel` (existing).
- Produces `LiveTurns`:
  - It renders `<PhaseFloor … next={outcome === 'running' ? nextSlot(format, turns) : null} />` inside its existing `role="log"` region.
  - Its `format` prop widens to the full phase shape above, plus a new prop `speakers: Record<Side, string>`.
  - `nextSlot` comes from `@debate-arena/engine`.

- [ ] **Step 1: Write the failing tests.**
  - `turn-item.test.ts` (update the existing tests to the new props):
    - The heading's accessible name is `'Opening: Fake A, For'`.
    - Five paragraphs → 2 visible `article > p`, and 3 inside `details.more`, whose summary is `'Read the full speech'`.
    - `truncated: true` with 5 paragraphs → the cut-off note is a direct child of the article, not inside `details`.
    - Existing literal-text and XSS assertions stay.
  - `phase-floor.test.ts`:
    - Two phases with Turns → two `h2`s, named `'Opening 300 words'` and `'Rebuttal 200 words'`.
    - `next: { phaseIndex: 1, side: 'against' }` with only Opening Turns → the Rebuttal section exists and shows `'Against speaks next'`.
    - No `next` → no `.next` element.
  - `live-turns.test.ts`: the existing tests pass with the new props. A running Debate with 1 Turn shows `'Against speaks next'`.
- [ ] **Step 2:** Run `pnpm --filter @debate-arena/web test`. Expected: the new assertions FAIL.
- [ ] **Step 3:** Implement `TurnItem`, `PhaseFloor` and the `LiveTurns` changes. The live dot pulses only under `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Step 4:** Run `pnpm --filter @debate-arena/web test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): the floor: phases as headings, speeches facing across it`

### Task 4: The Debate page band (Motion, benches, dispatch box)

**Files:**
- Create: `apps/web/src/components/DebateBand.astro`, `apps/web/src/components/OutcomeSummary.astro`, `apps/web/src/islands/CopyLink.svelte`
- Modify: `apps/web/src/islands/VotePanel.svelte`, `apps/web/src/pages/debates/[id].astro`
- Test: `apps/web/test/vote-panel.test.ts`, `apps/web/test/copy-link.test.ts` (new), `apps/web/e2e/pages.spec.ts`, `apps/web/e2e/member.spec.ts`

**Interfaces:**
- Consumes: `motionSize`, `dispatchState`, `outcome`, `spokeCount`, `debaterLabel` (Task 2); the band slot and `.lozenge` (Task 1).
- Produces:
  - `VotePanel` gains the prop `only?: 'before' | 'after'`. When set, the panel renders its form only when `phase === only`. Its title and intro render only for `only !== 'before'`; inside the dispatch box the question is `dispatch.ask`. Everything else is unchanged.
  - `CopyLink` props: `{ url: string; clipboard?: Pick<Clipboard, 'writeText'> }`. It defaults to `navigator.clipboard`, and tests pass a stub. A `button.secondary` labelled `share.copy`. On click it writes `url`, then announces `share.copied` in a `role="status"`. If that fails, it shows `share.manual` and a read-only `<input>` holding `url`, selected.
  - `OutcomeSummary.astro` props: `{ outcome: Outcome }`. It renders a serif headline (`outcome-headline`), then a `<ul>` with the judge row and the audience row (when not null).
  - `DebateBand.astro` props: `{ debate: PublicDebate; models: ModelInfo[]; signedIn: boolean }`. It renders:
    - the band label, and the `h1` with class `motion motion-{size}`;
    - `CopyLink client:visible` at the top right;
    - the bench row: For bench, dispatch box, Against bench. On desktop it's a grid of `1fr 15rem 1fr`, with the dispatch box `align-self: stretch` and the tallest. On the phone the box comes first, then the two benches.
    - the dispatch box content by `dispatchState` (spec table):
      - `ask` → `VotePanel client:load only="before"`;
      - `hidden` → `<details class="reveal"><summary>{t('dispatch.show')}</summary><OutcomeSummary/></details>`.
  - `[id].astro`:
    - The band goes into the `band` slot.
    - The body renders `PhaseFloor` (server, no client directive) for non-running Debates, and `LiveTurns client:load` for running live Debates.
    - It drops the old header list and the old top `VotePanel`.
    - When `turnsHidden`, it renders only the existing `debate.turnsHidden` notice, then the Record.

- [ ] **Step 1: Write the failing tests.**
  - `vote-panel.test.ts`:
    - `only: 'before'` with no vote → the `'Cast before-vote'` button exists.
    - `only: 'after'` with no vote → no form.
    - `only: 'after'`, complete, before cast → the `'Cast after-vote'` button exists.
  - `copy-link.test.ts`:
    - A clipboard stub resolves → status `'Link copied.'` and the stub was called with the url.
    - The stub rejects → an input with value `url` and the text `'Copy this link:'`.
  - `pages.spec.ts`, signed out, a finished fake Debate (seeded as the existing tests do):
    - a `summary` `'Show the result'` is visible;
    - the text `/carries the Motion|defeats the Motion|Split decision/` is hidden until the summary is clicked, then visible;
    - at 390×844, `document.documentElement.scrollWidth <= 390` for a 300-character Motion (seed one with a 300-character Motion of long words);
    - the existing assertions still hold (h1 = Motion, `Verdict` heading, `AI Audience Result`, ≥ 8 `AI-generated`).
  - `member.spec.ts`: the existing flow ('Cast before-vote' → Turns → 'Cast after-vote') still passes unchanged. Add: after the after-vote, the dispatch box shows its outcome without a summary (`dispatchState` `revealed`).
- [ ] **Step 2:** Run the unit tests and `pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e pages.spec.ts member.spec.ts`. Expected: the new assertions FAIL.
- [ ] **Step 3:** Implement the components, the `VotePanel` prop and the page changes. Motion sizes: `.motion-l` `clamp(2.0625rem, 1.2rem + 3.6vw, 3.75rem)`, `.motion-m` `clamp(1.75rem, 1.2rem + 2.4vw, 2.75rem)`, `.motion-s` `clamp(1.5rem, 1.1rem + 1.8vw, 2.25rem)`. All three set `overflow-wrap: anywhere`.
- [ ] **Step 4:** Rerun the step 2 commands. Expected: PASS, axe included.
- [ ] **Step 5:** Commit: `feat(web): debate band with benches and an ask-first dispatch box`

### Task 5: Verdict, audience division, AI audience and the Record

**Files:**
- Create: `apps/web/src/components/SwingChart.astro`, `apps/web/src/components/DebateRecord.astro`
- Modify: `apps/web/src/components/VerdictView.astro`, `apps/web/src/components/AudienceResultView.astro`, `apps/web/src/pages/debates/[id].astro`, `apps/web/src/lib/debate.ts`
- Test: `apps/web/test/debate.test.ts`, `apps/web/e2e/moderation.spec.ts`, `apps/web/e2e/batch.spec.ts`

**Interfaces:**
- Produces `swingBars(result: OxfordResult): { for: { points: number; width: string }; against: { points: number; width: string } }` in `lib/debate.ts`. `width` is `${min(|points|, 100) / 2}%`, the share of the half-axis. Points are rounded to 1 decimal.
- `SwingChart.astro` props: `{ result: OxfordResult; label: string }`.
  - An `aria-hidden` axis: For's bar grows left from the centre, Against's grows right.
  - Each bar is labelled outside it, as `sideLabel + signed points`.
  - Below the axis, a `<p>` with `label` (the `swingText()` sentence) as the text alternative.
- `VerdictView`:
  - A brass `.lozenge` sits above a `--surface` box with a `--brass` border.
  - Its `h2` is `verdict.title`.
  - The winner reads `t('verdict.side', { side, model })`, in serif and the side colour.
  - Then the reasoning paragraphs (serif), and the judges line with the AI label.
- `AudienceResultView` props: `{ result: PublicDebate['audienceResult'] }`, plus a named slot `vote`. It renders `h2 audience.title`, the named slot `vote` (where the page puts `VotePanel client:load only="after"`), `SwingChart`, and the closes line.
- `DebateRecord.astro` props: `{ debate: PublicDebate; models: ModelInfo[]; signedIn: boolean }`.
  - `h2 record.title`, then a `<dl>`:
    - Format: name and phase names;
    - Judge: `record.picked`;
    - Started: `createdAt`;
    - Finished: `completedAt`, when present;
    - Kind: `batch.label` for batch Debates.
  - Then `CopyLink client:visible`.
  - Then `<details class="report"><summary>` with a flag icon (inline stroke SVG, `aria-hidden`) and `report.summary`, holding `ReportForm client:visible` and `<p class="muted">{t('record.review')}</p>`.
  - Desktop: two columns. Phone: stacked.
- Removes `.card` from these components. A section is set off by a 2px `--ink` top rule (Record) or the brass box (Verdict).

- [ ] **Step 1: Write the failing tests.**
  - `debate.test.ts` `swingBars`:
    - `{ for: 13, against: -13 }` → widths `'6.5%'`/`'6.5%'`, points 13/−13.
    - `{ for: 0, against: 0 }` → `'0%'`.
    - `{ for: 140 }` → `'50%'` (capped).
  - `moderation.spec.ts`: the report flow (`getByText('Report this Debate').click()` …) still passes. That's the existing test, unchanged.
  - `batch.spec.ts`: the existing assertions still pass (`Verdict` heading visible; no `/before-vote/` button; no `'Audience Result'` heading). Add: a summary `'Show the result'` is visible in the band.
- [ ] **Step 2:** Run `pnpm --filter @debate-arena/web test debate.test.ts`. Expected: FAIL on `swingBars`.
- [ ] **Step 3:** Implement the helper and components, and wire them into `[id].astro`: Verdict, then the audience division (live Debates only), then AI Audience (via `SwingChart` with `swingText(debate.aiAudience, 'aiVoters')`), then the Record.
- [ ] **Step 4:** Run `pnpm --filter @debate-arena/web test && pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): verdict, swing chart and the record of the debate`

### Task 6: Home as the order paper

**Files:**
- Modify: `apps/web/src/pages/index.astro`
- Test: `apps/web/e2e/pages.spec.ts`

**Interfaces:**
- Consumes: `debaterLabel`, the keys `feed.carried`, `feed.defeated`, `feed.sides`.
- Produces: the page `h1` `feed.title`, then the tagline, then `<ol class="order-paper" role="list">`. Each `<li>` holds:
  - the Motion link (serif, 1.375rem);
  - `feed.sides`;
  - the outcome word, `feed.carried` when the Verdict winner is For, else `feed.defeated`, with the AI label and the Self-Judging badge kept;
  - the Batch badge;
  - the date.
  - A counter in `--muted` serif in the left margin (CSS counter, `aria-hidden` via `::marker` styling).
  - A `--line` rule between entries. No cards.

- [ ] **Step 1: Write the failing test** in `pages.spec.ts`, signed out, with a finished fake Debate: the feed entry for the seeded Motion contains the text `/Carried|Defeated/`, and the text `'Fake A for, Fake B against'`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e pages.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): home as the order paper`

### Task 7: Start a Debate as choosing the benches

**Files:**
- Modify: `apps/web/src/islands/StartDebateForm.svelte`, `apps/web/src/pages/new.astro`
- Test: `apps/web/test/start-debate-form.test.ts`

**Interfaces:**
- `StartDebateForm` markup changes only. Behaviour, props and labels stay the same ('Motion', 'Debater For', 'Debater Against', 'Judge', 'Batch Debate', 'Add AI Voters', 'Start the Debate', the cost line).
  - The Motion `textarea` is set in serif at 1.375rem.
  - The two Debater selects sit side by side (stacked below 40rem) in `<div class="benches">`. Each is in a `.bench.bench-for` / `.bench.bench-against` wrapper with a 6px top border in the side colour.
  - The Judge, batch and AI-voter options follow, then the cost line and the submit button.

- [ ] **Step 1: Write the failing test** in `start-debate-form.test.ts`: the `'Debater For'` select is inside an element with class `bench-for`, and `'Debater Against'` inside `bench-against`. The existing tests stay unchanged.
- [ ] **Step 2:** Run `pnpm --filter @debate-arena/web test start-debate-form.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @debate-arena/web test && pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e member.spec.ts batch.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): start a debate by choosing the benches`

### Task 8: Account, moderation, blocked, legal and error pages

**Files:**
- Modify: `apps/web/src/pages/account.astro`, `apps/web/src/pages/moderation.astro`, `apps/web/src/pages/blocked/[id].astro`, `apps/web/src/pages/impressum.astro`, `apps/web/src/pages/privacy.astro`, `apps/web/src/pages/terms.astro`, `apps/web/src/pages/404.astro`, `apps/web/src/pages/500.astro`, `apps/web/src/components/LegalSections.astro`, `apps/web/src/islands/AccountActions.svelte`, `apps/web/src/islands/DecisionForm.svelte`, `apps/web/src/islands/ReportForm.svelte`
- Test: `apps/web/e2e/legal.spec.ts`, `apps/web/e2e/moderation.spec.ts`, `apps/web/e2e/member.spec.ts`

**Interfaces:**
- No new interfaces.
- Remove every remaining `.card` use. Delete `.card` from `global.css` once nothing uses it; `grep -rn "card" apps/web/src` returns nothing.
- Sections are separated by a `--line` top rule with `--space` padding.
- Legal text sits in `.wrap` (the reading measure), with h2s in serif.
- The moderation queue items become a list with rules, like the order paper, without numbers.

- [ ] **Step 1:** Run `pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e`. Expected: PASS. This is the baseline before restyling. The existing e2e tests cover these pages' content and axe, and this task changes their look only.
- [ ] **Step 2:** Restyle the pages.
- [ ] **Step 3:** Rerun the step 1 commands, and `grep -rn "card" apps/web/src`. Expected: e2e PASS, and grep finds nothing.
- [ ] **Step 4:** Commit: `feat(web): chamber styling for account, moderation, legal and error pages`

### Task 9: Dark mode, Lighthouse, visual check

**Files:**
- Modify: `apps/web/e2e/pages.spec.ts`, plus whatever the checks below fix.

- [ ] **Step 1: Write the failing test** in `pages.spec.ts`: `test.describe` with `test.use({ colorScheme: 'dark' })`. It runs `expectNoAxeViolations` on `/`, a finished Debate (with the result revealed by clicking `'Show the result'`), and `/new` while signed in. Expected: PASS if the tokens are right. Fix any violation in `global.css`.
- [ ] **Step 2:** Run `pnpm --filter @debate-arena/web lighthouse`. Expected: performance ≥ 0.9, SEO 1, accessibility 1 on all three pages. If performance is below 0.9, check the font preload and LCP element first; do not drop the preload.
- [ ] **Step 3:** Take full-page screenshots, at 412×823 and 1280×800, in light and dark, of: home, a finished live Debate (hidden and revealed), a running live Debate, a batch Debate, a failed Debate, and `/new`. Use Playwright from a scratch script, not committed. Compare them with the approved mockup. Fix any overlap, any rule that crosses a heading, or any element off-screen.
- [ ] **Step 4:** Run `/Users/k/.claude/skills/impeccable/scripts/impeccable detect --json` on the built HTML of those pages (save each page's HTML with Playwright). Fix real findings; list any false positives in the PR description.
- [ ] **Step 5:** Run `pnpm check && pnpm --filter @debate-arena/web e2e`. Expected: PASS.
- [ ] **Step 6:** Commit: `test(web): dark-mode axe pass; fixes from the visual check`
