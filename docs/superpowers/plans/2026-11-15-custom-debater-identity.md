# Custom Debater Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing "API Debater" to "Custom Debater", and let whoever drives a Custom seat give it an optional nickname and a self-reported model, at start or with that Side's first Turn.

**Architecture:** The seat stays `kind: 'api'` in code and on the wire (`'custom'` is accepted as an alias). It gains optional `name` and `model` fields inside `setup_json` (no D1 migration). One engine function validates the identity everywhere. A name or model is public text, so it is screened like a Motion, failing closed. An identity set on a first Turn is broadcast as a new live event.

**Tech Stack:** TypeScript, Cloudflare Workers + D1 (SQLite JSON1), Hono, Astro + Svelte 5 islands, vitest, Playwright.

**Spec:** No separate spec doc. The decisions below were made by the user on 2026-11-15 and serve as the spec. Background: `docs/superpowers/specs/2026-11-15-all-models-and-api-debaters-design.md`.

### Decisions (user, 2026-11-15)
1. **Label:** "Custom". The picker option reads `Custom — submit this side’s Turns yourself`. The bench, feed and verdict say `Custom Debater`.
2. **When identity is set:** at start (`POST /api/debates`), or with that Side's **first** Turn if it was not set at start.
3. **Model:** free text, shown as self-reported (unverified). It is never matched against the catalog.

> **Amended (user, 2026-11-15, after implementation):** naming with the first Turn was removed as more complexity
> than it was worth (only the starting Member submits Turns, so they can name the seat at start). An identity is set
> **at start only**, screened with the Motion; names are checked against an allow-list (letters, marks, digits,
> spaces, simple punctuation; no blank-looking fillers) instead of a Cc/Cf block-list. Task 3 and the `speak`/`follow`
> parts of Task 4 and the live update in Task 5 no longer apply.

## Global Constraints

- Code identifiers stay as they are: `kind: 'api'`, `API_DEBATER`, `isApiSlot`, `apiSides`, the `/turns/:slot` routes and `api-debater.spec.ts`. Only user-facing copy changes.
- The Turn label stays `Submitted via API` (ADR 0005: never labelled AI-generated).
- Nickname: trimmed, 1–40 characters. Model: trimmed, 1–60 characters. Whitespace-only counts as absent. Reject any character in Unicode categories `Cc` or `Cf` (control characters and bidi/zero-width formatting) with 400.
- Error copy:
  - Bad name: `Custom Debater name must be 1–40 characters, without control characters`
  - Bad model: `Custom Debater model must be 1–60 characters, without control characters`
  - Late or changed identity: `A Custom Debater's name and model can be set only at start or with its first Turn`
- Display:
  - Unnamed: `Custom Debater`. Named: `<name> (Custom)`.
  - The model always appears as `self-reported model: <model>`, never as a catalog label. In the CLI it appears inside the parentheses: `Atlas (Custom, self-reported model: gpt-6)`.
- Screening: identity text goes through the same screener, labelled `Name and model given by a debater in a public debate`. A Flag Unlists the Debate (via `flagDebate`), and a failed screen Flags (fail closed).
- Budget: each Custom seat reserves one extra screening call for its identity, whether or not one is ever given.
- Small fixes ship with `pnpm ship`. This is a feature, so it goes through a PR (`delivery-workflow` memory).

## Review Focus

1. **Bidi/zero-width spoofing.** A name like `"Atlas‮gnp.exe"` or `"​"` is rejected with 400, not stored. Tested in Task 1.
2. **A bot that sends its identity with every Turn.** Re-sending the *identical* name/model on later Turns is accepted silently. A *different* or *new* identity after the first Turn is refused with 409 and the Turn is not stored. Tested in Task 3.
3. **Non-ASCII names** (`Zoë`, `ドラゴン`) round-trip from the CLI through the query string to the page. Tested in Tasks 3 and 4.
4. **Old Debates** stored as `{ kind: 'api' }` render as `Custom Debater` with no model line, on the web and in the CLI. Tested in Tasks 4 and 5.
5. **An offensive nickname** Unlists the Debate even when the Motion is clean, and a screener error also Flags. Tested in Tasks 2 and 3.

---

### Task 1: Engine: identity type, validation, screening label, budget

**Files:**
- Modify: `packages/engine/src/domain.ts:20-21`
- Create: `packages/engine/src/debate/custom-identity.ts`, `packages/engine/src/debate/custom-identity.test.ts`
- Modify: `packages/engine/src/moderation/screen.ts:19-26` (+ its test)
- Modify: `packages/engine/src/budget/estimate.ts:60-85` (+ its test)
- Modify: `packages/engine/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `type Debater = … | { kind: 'api'; name?: string; model?: string }`
  - `interface CustomIdentity { name?: string; model?: string }`
  - `MAX_CUSTOM_NAME_LENGTH = 40`, `MAX_CUSTOM_MODEL_LENGTH = 60`
  - `parseCustomIdentity(input: { name?: unknown; model?: unknown }): CustomIdentity | string`: the cleaned identity, or the exact error copy.
  - `identityText(identity: CustomIdentity): string`: the text to screen, `Name: <name>\nModel: <model>` with absent lines left out.
  - `ScreenedText = 'motion' | 'turn' | 'name'`

- [ ] **Step 1: Write failing tests** in `custom-identity.test.ts`:
  - `parseCustomIdentity({ name: '  Atlas ', model: 'gpt-6' })` → `{ name: 'Atlas', model: 'gpt-6' }`
  - `({ name: '   ' })` → `{}`
  - `({})` → `{}`
  - `({ name: 'x'.repeat(41) })` → the name error copy
  - `({ model: 'x'.repeat(61) })` → the model error copy
  - `({ name: 'Atlas‮gnp' })` and `({ name: '​' })` → the name error copy
  - `({ name: 7 })` → the name error copy
  - `identityText({ name: 'Atlas' })` → `'Name: Atlas'`

  In the screen test: `buildScreenMessages('Name: A', 'name')[0].content` contains `Name and model given by a debater in a public debate`.

  In the estimate test: a setup with one `{ kind: 'api' }` seat and a screener costs exactly one more `cost(screener, base + IDENTITY_MAX_BYTES, SCREEN_OUTPUT_TOKENS)` than before. Export `IDENTITY_MAX_BYTES = 4 * (MAX_CUSTOM_NAME_LENGTH + MAX_CUSTOM_MODEL_LENGTH) + 16`.
- [ ] **Step 2:** `pnpm --filter @debate-arena/engine test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The control-character check is `/[\p{Cc}\p{Cf}]/u`. Length is measured in UTF-16 `.length`, matching `maxlength` in the web. Update the `Debater` doc comment to say "a Custom Debater (code: 'api')".
- [ ] **Step 4:** `pnpm --filter @debate-arena/engine test && pnpm --filter @debate-arena/engine typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(engine): Custom Debater identity: validation, screening label, reserved screen`.

### Task 2: API start: accept identity at start and screen it in the first step

**Files:**
- Modify: `apps/api/src/debates/start.ts:29-35`, `:83-100`, `:126-131`
- Modify: `apps/api/src/debates/steps.ts:60-68`
- Test: `apps/api/test/plan.test.ts`, `apps/api/test/steps.test.ts`

**Interfaces:**
- Consumes: `parseCustomIdentity` and `identityText` (Task 1).
- Produces: `StartDebateInput.debaters: { for: SeatInput; against: SeatInput }`, where `type SeatInput = ModelId | { kind: 'api' | 'custom'; name?: unknown; model?: unknown }`. `CUSTOM_DEBATER_VALUES = ['api', 'custom']`.

- [ ] **Step 1: Write failing tests**
  - `plan.test.ts`:
    - `'a Custom Debater may be named at start'`: `debaters.for = { kind: 'custom', name: 'Atlas', model: 'gpt-6' }` gives `setup.debaters.for` equal to `{ kind: 'api', name: 'Atlas', model: 'gpt-6' }`.
    - `'"custom" seats a Custom Debater'`: the string `'custom'` gives `{ kind: 'api' }`.
    - `'a bad Custom Debater name is refused'`: a name of 41 characters gets 400 with the name error copy.
    - Change the expected copy in the existing test at :97 to `'A Slow Debate cannot have a Custom Debater'`.
  - `steps.test.ts`:
    - `'the first step screens a Custom Debater identity and Flags an unsafe one'`: a FakeModelClient answers the Motion `safe` and the identity `unsafe\nS10`, so the Debate is Unlisted and still completes.
    - `'an identity screen that errors Flags'`
    - `'a Custom seat without identity makes no identity screen call'`
- [ ] **Step 2:** `pnpm --filter @debate-arena/api test -- plan steps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `parseInput` accepts each Side as a string or a `{ kind, name?, model? }` object, and its error text becomes `debaters must name a model (or "custom") for each Side …`.
  - `seat()` validates the identity with `parseCustomIdentity`, then spreads the cleaned fields into `{ kind: 'api' }`.
  - In `runStep`, in the Motion screen block, after `saveScreen` succeeds: for each Side whose seat is `api` with a name or model, screen `identityText(...)` with `what: 'name'` and call `flagDebate` if flagged or on error. This mirrors `screenApiTurn`; extract a shared `screenSubmitted(screen, db, debateId, text, what)` from `apps/api/src/debates/api-turn.ts:139-152` and use it in both places.
- [ ] **Step 4:** `pnpm --filter @debate-arena/api test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): name a Custom Debater at start, screened in the first step`.

### Task 3: API Turn: set identity with the first Turn, broadcast it

**Files:**
- Modify: `apps/api/src/db/debates.ts` (new function)
- Modify: `apps/api/src/debates/api-turn.ts:69-112`
- Modify: `apps/api/src/app.ts:291-318`
- Modify: `apps/api/src/live/events.ts`
- Test: `apps/api/test/api-turn.test.ts`, `apps/api/test/db-debates.test.ts`

**Interfaces:**
- Consumes: `parseCustomIdentity` and `identityText` (Task 1), and `screenSubmitted` (Task 2).
- Produces:
  - `setCustomIdentity(db, debateId, side: Side, identity: CustomIdentity): Promise<boolean>`: one conditional `UPDATE … SET setup_json = json_set(…)`. It writes only while that seat's kind is `'api'` and its `name` and `model` are both NULL, and returns whether it wrote.
  - `submitApiTurn(deps, debate, slot, body, identity?: CustomIdentity)`: the existing signature plus the optional identity.
  - `ApiTurnResult` gains `identitySet: boolean` on 201.
  - `DebateEvent` gains `{ type: 'debater'; side: Side; debater: Debater }`.
  - The route reads query params `name` and `model` on `POST /debates/:id/turns/:slot`.

- [ ] **Step 1: Write failing tests** in `api-turn.test.ts`:
  - `'the first Turn may name its Custom Debater'`: submit with `{ name: 'Zoë', model: 'llama-4' }`. The stored seat is `{ kind: 'api', name: 'Zoë', model: 'llama-4' }`, the events include `{ type: 'debater', side: 'for', debater: <that seat> }` before the `turn` event, and the result has `identitySet: true`.
  - `'resending the same identity on a later Turn is accepted'`: 201, `identitySet: false`, no `debater` event.
  - `'a new or different identity after the first Turn is refused and the Turn not stored'`: 409 with the late-identity copy, and `turns` unchanged.
  - `'an identity given at start cannot be changed by the first Turn'`: 409.
  - `'a bad name is refused before the body is read'`: 400 with the name copy, the stream not consumed and no draft events.
  - In `routes`: `'POST …/turns/0?name=%E3%83%89%E3%83%A9%E3%82%B4%E3%83%B3 stores ドラゴン'`.
  - `db-debates.test.ts`: `setCustomIdentity` returns false for an AI seat or a seat already named.
- [ ] **Step 2:** `pnpm --filter @debate-arena/api test -- api-turn db-debates routes`. Expected: FAIL.
- [ ] **Step 3: Implement.** Order inside `submitApiTurn`:
  1. Validate the identity (400).
  2. Decide whether it is allowed before reading the body. It is allowed only when no identity is stored and this is the Side's first Turn (no earlier Turn of that Side in `debate.turns`), or when it equals the stored one. Otherwise return 409.
  3. Read the body and append the Turn as today.
  4. If the identity is new, call `setCustomIdentity` and then notify the `debater` event before the `turn` event.

  In `app.ts`, read `c.req.query('name')` and `c.req.query('model')`. When `identitySet` is true, also `waitUntil(screenSubmitted(…, identityText(identity), 'name'))`.
- [ ] **Step 4:** `pnpm --filter @debate-arena/api test && pnpm --filter @debate-arena/api typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): a Custom Debater may name itself with its first Turn`.

### Task 4: api-client and CLI: flags, rendering, live event

**Files:**
- Modify: `packages/api-client/src/index.ts:49-66` (+ `index.test.ts`)
- Modify: `packages/cli/src/run.ts` (USAGE, OPTIONS, `start`, `speak`)
- Modify: `packages/cli/src/render.ts:12-16`
- Modify: `packages/cli/src/follow.ts:121-146`
- Test: `packages/cli/src/run.test.ts`, `speak.test.ts`, `render.test.ts`, `follow.test.ts`

**Interfaces:**
- Consumes: the start body shape (Task 2), the query params and the `debater` event (Task 3).
- Produces:
  - `submitTurn(baseUrl, token, debateId, slot, body, fetcher = fetch, identity?: { name?: string; model?: string })`, which appends `?name=…&model=…` built with `URLSearchParams`, only for keys given.
  - CLI flags: `--for-name`, `--for-model`, `--against-name`, `--against-model` on `start`; `--name` and `--model` on `speak`.

- [ ] **Step 1: Write failing tests**
  - api-client: `submitTurn(…, undefined, { name: 'Zoë' })` posts to `…/turns/2?name=Zo%C3%AB`.
  - run:
    - `start M --for custom --for-name Atlas --for-model gpt-6 --against b/two --detach` sends `debaters.for` equal to `{ kind: 'custom', name: 'Atlas', model: 'gpt-6' }`.
    - `--for a/one --for-name X` exits 1 with `--for-name and --for-model need --for custom`.
  - speak: `speak d1 --slot 4 --name Atlas` posts to `…/turns/4?name=Atlas`.
  - render:
    - `{ kind: 'api' }` → `Custom Debater`
    - `{ kind: 'api', name: 'Atlas', model: 'gpt-6' }` → `Atlas (Custom, self-reported model: gpt-6)`
    - `{ kind: 'api', model: 'gpt-6' }` → `Custom Debater (self-reported model: gpt-6)`
  - follow: a `debater` event prints `For is now Atlas (Custom)` and later Turn headers use the new name.
  - Update the assertion at `speak.test.ts:128` to `For: Custom Debater`.
- [ ] **Step 2:** `pnpm --filter @debate-arena/cli test && pnpm --filter @debate-arena/api-client test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `custom` and `api` are both accepted for `--for`/`--against`. USAGE reads `start <motion> --for <model|custom> --against <model|custom>`, with `"custom" seats a Custom Debater whose Turns you send with speak`. Keep the `Waiting for … via the API` line.
- [ ] **Step 4:** Rerun the step 2 commands, plus `pnpm --filter @debate-arena/cli typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(cli): name a Custom Debater with start or speak`.

### Task 5: Web: copy, labels, start form fields, live update

**Files:**
- Modify: `apps/web/src/i18n/en.ts:96-107`, `:281-282` (+ new keys)
- Modify: `apps/web/src/lib/debate.ts:228-231`
- Modify: `apps/web/src/islands/StartDebateForm.svelte:33`, `:110-116`, `:209-248`
- Modify: `apps/web/src/components/DebateBand.astro:23-26`, `:45`
- Modify: `apps/web/src/islands/LiveTurns.svelte:170-180` (and its `speakers` state)
- Test: `apps/web/test/start-debate-form.test.ts`, `model-picker.test.ts`, `turn-item.test.ts`, `live-turns.test.ts`, a new `debater-label.test.ts`, and `apps/web/e2e/api-debater.spec.ts`

**Interfaces:**
- Consumes: the start body shape (Task 2) and the `debater` event (Task 3).
- Produces:
  - `debaterLabel(debater, models): string`, which gives `Custom Debater` or `<name> (Custom)`.
  - `debaterNote(debater): string | null`, which gives `self-reported model: <model>` for an api seat with a model, and null otherwise.
  - Constants mirrored from the engine (the same way `MAX_MOTION_LENGTH` is mirrored at `debate.ts:214`): `MAX_CUSTOM_NAME_LENGTH = 40`, `MAX_CUSTOM_MODEL_LENGTH = 60`.

- [ ] **Step 1: Write failing tests**
  - `debater-label.test.ts`: the three display cases from the Global Constraints, including an old `{ kind: 'api' }` with no note.
  - `start-debate-form.test.ts`:
    - Choosing Custom for For shows the inputs `Nickname (optional)` and `Model (optional, self-reported)` with `maxlength` 40 and 60.
    - Filling them sends `debaters.for` equal to `{ kind: 'custom', name: 'Atlas', model: 'gpt-6' }`.
    - Leaving them empty sends `'api'`, unchanged from today.
  - `live-turns.test.ts`: a `debater` event updates the speaker shown on later Turns to `Atlas (Custom)`.
  - Update the existing copy assertions (`API — submit…` → `Custom — submit this side’s Turns yourself`; `API Debater` → `Custom Debater`). `Submitted via API` stays.
  - e2e `api-debater.spec.ts`: pick `Custom`, fill the nickname `Atlas`, expect `.bench-model` to have the text `Atlas (Custom)`.
- [ ] **Step 2:** `pnpm --filter @debate-arena/web test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy:
  - `new.api` = `Custom — submit this side’s Turns yourself`
  - `debater.api` = `Custom Debater`
  - `debater.named` = `{name} (Custom)`
  - `debater.model` = `self-reported model: {model}`
  - `new.customName` = `Nickname (optional)`
  - `new.customModel` = `Model (optional, self-reported)`
  - Delete the unused `new.slowNoApi`.

  The bench in `DebateBand.astro` renders `debaterNote` as a muted line under `.bench-model` when it is not null. `LiveTurns` keeps `speakers` in `$state` and, on a `debater` event, sets `speakers[event.side] = debaterLabel(event.debater, models)`. The static band updates on reload; that is acceptable and documented in a comment.
- [ ] **Step 4:** `pnpm --filter @debate-arena/web test && pnpm --filter @debate-arena/web typecheck && pnpm --filter @debate-arena/web e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): Custom Debater copy, nickname and self-reported model`.

### Task 6: Glossary and final check

**Files:**
- Modify: `GLOSSARY.md:25-27`

- [ ] **Step 1:** Rename the entry to **Custom Debater**:
  > A Debater whose Turns the starting Member submits through the platform API, written by hand or by their own program, instead of a platform model generating them. It may carry a nickname and a self-reported model, which the platform shows but does not verify. Its Turns are labelled as submitted via API, never as AI-generated. In code: `kind: 'api'`.

  Its `_Avoid_` line: `API Debater (former name), Human Debater, external bot, BYO model`.
- [ ] **Step 2:** Run `pnpm check`. Expected: lint has no errors, and typecheck and tests all PASS.
- [ ] **Step 3:** Commit: `docs: Custom Debater in the glossary`. Push the branch and open a PR when asked.
