# Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo and build `@debate-arena/engine`, the pure-TypeScript Debate engine that runs a Classic Debate end to end (Turns, Verdict, Oxford Swing, AI Audience, Budget) against a fake model, fully offline.

**Architecture:** A pnpm + Turborepo monorepo; this plan creates only `packages/engine`. The engine has no Cloudflare, network or storage code (ADR 0002, ADR 0003): it exposes step functions (`nextSlot`, `generateTurn`, `judgeDebate`, …) that a hosting layer calls one job at a time, and talks to models only through the `ModelClient` interface. Plan 2 adds the OpenRouter client and Cloudflare hosting.

**Tech Stack:** Node 24, pnpm 12, Turborepo, TypeScript (strict), oxlint, Vitest, GitHub Actions.

**Spec:** `GLOSSARY.md`, `docs/adr/0001`–`0006`, roadmap in `docs/superpowers/plans/2026-11-13-roadmap.md`. Use glossary terms exactly in identifiers and copy (`Motion`, `Side`, `Turn`, `Verdict`, `Panel`, `Swing`, never `topic`, `pro/con`, `round`, `jury`).

## Global Constraints

- Engine source imports nothing from Cloudflare, Node built-ins, or network libraries; only standard ECMAScript and `Intl`.
- Sides are exactly `'for' | 'against'`; Audience and AI Voter stances add `'undecided'`.
- Model ids are OpenRouter ids, `provider/model` (e.g. `anthropic/claude-sonnet-5-5`); the provider prefix is the model's family.
- A Verdict always names one Side; never a draw. The Audience Result and AI Audience Result may tie.
- Swing counts only voters who cast both a before and an after stance.
- Panels hold exactly one Judge in this release (modeled as an array).
- Classic Format: Opening 300 words / 120 s, Rebuttal 200 words / 80 s, Closing 150 words / 60 s; each Phase For then Against; Oxford voting with a 7-day window.
- Turns are cut off at the word limit and the Debate continues (`truncated: true`).
- Prompts are neutral (no Personas) and instruct models to answer in the Motion's language.
- Money is integer micro-USD.
- No formatter; oxlint is the only linter (ADR 0006).

## Review Focus

- Model output longer than the Phase limit: the Turn keeps exactly the first `maxWords` words and is marked truncated (Task 3, Task 5).
- Motions and Turns in languages without spaces (Chinese, Japanese): words are counted with `Intl.Segmenter`, not by whitespace (Task 3).
- A Judge replying with prose, a fenced JSON block, `"draw"` or a wrong Side name: one retry, then a typed error, never a draw (Task 7).
- Votes with only a before or only an after stance, and Debates with zero paired voters: ignored, and a tie with `counted: 0` (Task 8).
- A model returning an empty or whitespace-only reply: `EmptyTurnError`, so the job layer can retry instead of storing a blank Turn (Task 5).

---

## File Structure

```
package.json                 root scripts, packageManager pnpm@12.8.1
pnpm-workspace.yaml          packages/*, apps/*
turbo.json                   typecheck, test tasks
tsconfig.base.json           strict shared compiler options
.oxlintrc.json               lint config
.nvmrc                       24
.github/workflows/ci.yml     lint + typecheck + test
packages/engine/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts               public exports
  src/domain.ts              shared domain types
  src/errors.ts              typed engine errors
  src/formats/classic.ts     the Classic Format
  src/turns/words.ts         word counting and truncation
  src/models/client.ts       ModelClient interface
  src/models/fake.ts         FakeModelClient
  src/debate/schedule.ts     Turn slots of a Format
  src/debate/prompts.ts      Debater prompt
  src/debate/generate-turn.ts
  src/judging/panel.ts       Panel suggestion, Self-Judging, validation
  src/judging/judge.ts       Judge prompt, Verdict parsing, judging
  src/voting/oxford.ts       Oxford Swing
  src/voting/ai-voter.ts     AI Voter stances and AI Audience Result
  src/budget/estimate.ts     worst-case Budget
```

Tests sit next to the code as `*.test.ts`.

---

### Task 1: Monorepo, tooling and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.oxlintrc.json`, `.nvmrc`, `.github/workflows/ci.yml`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/index.test.ts`

**Interfaces:**
- Produces: root scripts `pnpm lint` (`oxlint`), `pnpm typecheck` (`turbo run typecheck`), `pnpm test` (`turbo run test`), `pnpm check` (lint + typecheck + test). Package `@debate-arena/engine` with `"type": "module"`, `"exports": { ".": "./src/index.ts" }` (source exported directly; bundlers in later plans compile it), scripts `typecheck: tsc --noEmit`, `test: vitest run`.

- [ ] **Step 1: Scaffold root config**

Root `package.json`: `"private": true`, `"packageManager": "pnpm@12.8.1"`, `"engines": { "node": ">=24" }`. `.nvmrc`: `24`. `pnpm-workspace.yaml`: `packages: ["packages/*", "apps/*"]`. `turbo.json`: tasks `typecheck` and `test` with `"dependsOn": ["^typecheck"]` and `"outputs": []`. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `target`/`lib` `ES2023`, `module` `ESNext`, `moduleResolution` `Bundler`, `noEmit`, `skipLibCheck`. `.oxlintrc.json`: categories `correctness` error, `suspicious` warn; ignore `**/node_modules`, `.claude/`.

Install current versions: `pnpm add -D -w turbo typescript oxlint` and `pnpm --filter @debate-arena/engine add -D vitest typescript` (after Step 2 creates the package).

- [ ] **Step 2: Scaffold the engine package**

`packages/engine/tsconfig.json` extends `../../tsconfig.base.json`, `include: ["src"]`. `vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts']`. `src/index.ts` exports `ENGINE_VERSION = '0.1.0'`.

- [ ] **Step 3: Write the smoke test**

```ts
import { expect, test } from 'vitest';
import { ENGINE_VERSION } from './index';
test('engine exports a version', () => { expect(ENGINE_VERSION).toBe('0.1.0'); });
```

- [ ] **Step 4: Run all checks**

Run: `pnpm install && pnpm check`
Expected: oxlint reports 0 errors, typecheck passes, 1 test passes.

- [ ] **Step 5: Add CI**

`.github/workflows/ci.yml`: on `pull_request` and `push` to `main`; one job on `ubuntu-latest`: checkout, `pnpm/action-setup`, `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm check`. (Turborepo remote cache is added in Plan 7.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm/turborepo monorepo with engine package and CI"
```

---

### Task 2: Domain types and the Classic Format

**Files:**
- Create: `packages/engine/src/domain.ts`, `packages/engine/src/errors.ts`, `packages/engine/src/formats/classic.ts`
- Modify: `packages/engine/src/index.ts` (re-export)
- Test: `packages/engine/src/formats/classic.test.ts`

**Interfaces:**
- Produces (`domain.ts`):

```ts
export type Side = 'for' | 'against';
export type Stance = Side | 'undecided';
export type ModelId = string; // OpenRouter id "provider/model"
export interface Motion { text: string }
export interface Phase { name: string; order: Side[]; maxWords: number; maxSeconds: number }
export interface RubricCriterion { name: string; description: string }
export interface Rubric { criteria: RubricCriterion[] }
export interface OxfordVotingMethod { kind: 'oxford'; windowDays: number }
export type VotingMethod = OxfordVotingMethod;
export interface Format { id: string; name: string; phases: Phase[]; rubric: Rubric; votingMethod: VotingMethod }
export type Debater = { kind: 'ai'; model: ModelId } | { kind: 'human'; memberId: string };
export interface TurnSlot { phaseIndex: number; side: Side }
export interface Turn extends TurnSlot { text: string; truncated: boolean }
export interface Verdict { winner: Side; reasoning: string; judges: ModelId[] }
export interface DebateSetup { motion: Motion; format: Format; debaters: Record<Side, Debater>; panel: ModelId[] }
```

- Produces (`errors.ts`): `class EngineError extends Error` and subclasses `DebateCompleteError`, `HumanTurnNotSupportedError`, `EmptyTurnError`, `DebateNotFinishedError`, `VerdictParseError`, `StanceParseError`, `InvalidPanelError`, `DuplicateVoterError`, `UnknownModelPriceError`, each setting `name` to its class name.
- Produces (`formats/classic.ts`): `export const CLASSIC_FORMAT: Format`.

- [ ] **Step 1: Write the failing test**

```ts
test('Classic Format matches the spec', () => {
  expect(CLASSIC_FORMAT.id).toBe('classic');
  expect(CLASSIC_FORMAT.phases.map(p => [p.name, p.order, p.maxWords, p.maxSeconds])).toEqual([
    ['Opening', ['for', 'against'], 300, 120],
    ['Rebuttal', ['for', 'against'], 200, 80],
    ['Closing', ['for', 'against'], 150, 60],
  ]);
  expect(CLASSIC_FORMAT.rubric.criteria.map(c => c.name))
    .toEqual(['Argument strength', 'Rebuttal quality', 'Evidence', 'Clarity']);
  expect(CLASSIC_FORMAT.votingMethod).toEqual({ kind: 'oxford', windowDays: 7 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @debate-arena/engine test -- classic`
Expected: FAIL, cannot resolve `./classic`.

- [ ] **Step 3: Implement `domain.ts`, `errors.ts`, `CLASSIC_FORMAT`**

Give each Rubric criterion a one-sentence description (e.g. Evidence: "Supports claims with accurate, relevant facts or examples").

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @debate-arena/engine test -- classic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): domain types, errors and Classic Format"
```

---

### Task 3: Word counting and truncation

**Files:**
- Create: `packages/engine/src/turns/words.ts`
- Test: `packages/engine/src/turns/words.test.ts`

**Interfaces:**
- Produces: `countWords(text: string): number`; `truncateToWords(text: string, maxWords: number): { text: string; truncated: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('counts words, ignoring punctuation', () => {
  expect(countWords('Remote work beats office work.')).toBe(5);
  expect(countWords('   ')).toBe(0);
});
test('counts words in languages without spaces', () => {
  expect(countWords('我喜欢猫')).toBeGreaterThan(1);
});
test('leaves text within the limit untouched', () => {
  expect(truncateToWords('One two three.', 3)).toEqual({ text: 'One two three.', truncated: false });
});
test('cuts at the limit, keeping original spacing', () => {
  expect(truncateToWords('One two,  three four five', 3)).toEqual({ text: 'One two,  three', truncated: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @debate-arena/engine test -- words`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement with `Intl.Segmenter(undefined, { granularity: 'word' })`**

Count segments with `isWordLike`. Truncation slices the original string at the end index of the `maxWords`-th word-like segment and trims trailing whitespace only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @debate-arena/engine test -- words`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/turns
git commit -m "feat(engine): language-aware word counting and truncation"
```

---

### Task 4: Model interface and fake model

**Files:**
- Create: `packages/engine/src/models/client.ts`, `packages/engine/src/models/fake.ts`
- Test: `packages/engine/src/models/fake.test.ts`

**Interfaces:**
- Consumes: Task 2 `ModelId`, Task 3 `countWords`.
- Produces (`client.ts`):

```ts
export interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ModelRequest { model: ModelId; messages: ModelMessage[]; maxOutputTokens: number }
export interface ModelResponse { text: string; inputTokens: number; outputTokens: number }
export interface ModelClient { complete(request: ModelRequest): Promise<ModelResponse> }
```

- Produces (`fake.ts`): `class FakeModelClient implements ModelClient` with `constructor(respond?: (request: ModelRequest) => string)`, a public `calls: ModelRequest[]`, and token counts as `countWords` of the joined input / output. The default responder returns `` `Fake reply from ${request.model}.` ``.

- [ ] **Step 1: Write the failing tests**

```ts
test('records calls and uses the default reply', async () => {
  const client = new FakeModelClient();
  const res = await client.complete({ model: 'a/x', messages: [{ role: 'user', content: 'hi there' }], maxOutputTokens: 10 });
  expect(res.text).toBe('Fake reply from a/x.');
  expect(client.calls).toHaveLength(1);
});
test('uses a scripted responder', async () => {
  const client = new FakeModelClient(() => 'scripted');
  expect((await client.complete({ model: 'a/x', messages: [], maxOutputTokens: 1 })).text).toBe('scripted');
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/engine test -- fake`
Expected: FAIL before, PASS after (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/models
git commit -m "feat(engine): ModelClient interface and FakeModelClient"
```

---

### Task 5: Turn schedule and Turn generation

**Files:**
- Create: `packages/engine/src/debate/schedule.ts`, `packages/engine/src/debate/prompts.ts`, `packages/engine/src/debate/generate-turn.ts`
- Test: `packages/engine/src/debate/schedule.test.ts`, `packages/engine/src/debate/generate-turn.test.ts`

**Interfaces:**
- Consumes: Task 2 types, Task 3 `truncateToWords`/`countWords`, Task 4 `ModelClient`.
- Produces:
  - `turnSlots(format: Format): TurnSlot[]`: Phases in order, each Phase's `order` expanded.
  - `nextSlot(format: Format, turns: Turn[]): TurnSlot | null`: `turnSlots(format)[turns.length] ?? null`.
  - `TOKENS_PER_WORD = 1.4` (exported; Task 10 reuses it).
  - `buildTurnMessages(setup: DebateSetup, slot: TurnSlot, priorTurns: Turn[]): ModelMessage[]`
  - `generateTurn(setup: DebateSetup, priorTurns: Turn[], client: ModelClient): Promise<Turn>`

- [ ] **Step 1: Write the failing tests**

```ts
// schedule.test.ts
test('Classic has six slots, For first in each Phase', () => {
  expect(turnSlots(CLASSIC_FORMAT)).toEqual([
    { phaseIndex: 0, side: 'for' }, { phaseIndex: 0, side: 'against' },
    { phaseIndex: 1, side: 'for' }, { phaseIndex: 1, side: 'against' },
    { phaseIndex: 2, side: 'for' }, { phaseIndex: 2, side: 'against' },
  ]);
});
test('nextSlot returns null when all Turns exist', () => {
  expect(nextSlot(CLASSIC_FORMAT, Array(6).fill(turn))).toBeNull();
});

// generate-turn.test.ts — setup: Motion "Remote work beats office work", AI Debaters a/for-model and b/against-model, panel ['c/judge']
test('prompt names the Motion, Side, Phase, word limit and language rule', () => {
  const [system] = buildTurnMessages(setup, { phaseIndex: 0, side: 'for' }, []);
  expect(system.role).toBe('system');
  for (const s of ['Remote work beats office work', 'For', 'Opening', '300 words', "Motion's language"])
    expect(system.content).toContain(s);
});
test('prior Turns are passed in order', () => { /* 2 prior Turns appear in the user message in order */ });
test('first Turn uses the For Debater and the Opening limit', async () => {
  const client = new FakeModelClient();
  const t = await generateTurn(setup, [], client);
  expect(t).toMatchObject({ phaseIndex: 0, side: 'for', truncated: false });
  expect(client.calls[0].model).toBe('a/for-model');
  expect(client.calls[0].maxOutputTokens).toBe(Math.ceil(300 * 1.4));
});
test('over-long replies are cut at the Phase limit', async () => {
  const t = await generateTurn(setup, [], new FakeModelClient(() => 'word '.repeat(400)));
  expect(countWords(t.text)).toBe(300);
  expect(t.truncated).toBe(true);
});
test('empty replies throw EmptyTurnError', async () => {
  await expect(generateTurn(setup, [], new FakeModelClient(() => '  \n'))).rejects.toBeInstanceOf(EmptyTurnError);
});
test('throws when the Debate is complete or the Debater is human', async () => { /* DebateCompleteError, HumanTurnNotSupportedError */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @debate-arena/engine test -- schedule generate-turn`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

System prompt: a neutral debater instruction stating the Motion, the Debater's Side ("For"/"Against"), the Phase name, "at most N words", and "Respond in the Motion's language." User message: the prior Turns labeled with Phase and Side, then a request for this Turn. `maxOutputTokens = Math.ceil(maxWords * TOKENS_PER_WORD)`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/engine test -- schedule generate-turn`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/debate
git commit -m "feat(engine): Turn schedule and Turn generation with word limits"
```

---

### Task 6: Panel suggestion and Self-Judging

**Files:**
- Create: `packages/engine/src/judging/panel.ts`
- Test: `packages/engine/src/judging/panel.test.ts`

**Interfaces:**
- Produces:
  - `modelFamily(model: ModelId): string`: the part before the first `/`.
  - `suggestPanel(debaters: Debater[], candidates: ModelId[]): ModelId[]`: one Judge: the first candidate whose family differs from every AI Debater's family; else the first candidate that is not any Debater's model; else `candidates[0]`. Throws `InvalidPanelError` when `candidates` is empty.
  - `isSelfJudging(panel: ModelId[], debaters: Debater[]): boolean`: any Judge id equals an AI Debater's model id.
  - `validatePanel(panel: ModelId[]): void`: throws `InvalidPanelError` unless `panel.length === 1`.

- [ ] **Step 1: Write the failing tests**

```ts
const ai = (model: string): Debater => ({ kind: 'ai', model });
test('suggests a Judge from another family', () => {
  expect(suggestPanel([ai('anthropic/a'), ai('openai/b')], ['anthropic/j', 'openai/j', 'google/j'])).toEqual(['google/j']);
});
test('falls back to a different model of the same family', () => {
  expect(suggestPanel([ai('anthropic/a')], ['anthropic/a', 'anthropic/j'])).toEqual(['anthropic/j']);
});
test('detects Self-Judging by exact model id', () => {
  expect(isSelfJudging(['anthropic/a'], [ai('anthropic/a'), ai('openai/b')])).toBe(true);
  expect(isSelfJudging(['anthropic/j'], [ai('anthropic/a'), ai('openai/b')])).toBe(false);
});
test('Panels hold exactly one Judge in this release', () => {
  expect(() => validatePanel([])).toThrow(InvalidPanelError);
  expect(() => validatePanel(['x/1', 'y/2'])).toThrow(InvalidPanelError);
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/engine test -- panel`

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/judging/panel*
git commit -m "feat(engine): Panel suggestion and Self-Judging detection"
```

---

### Task 7: Judging and the Verdict

**Files:**
- Create: `packages/engine/src/judging/judge.ts`
- Test: `packages/engine/src/judging/judge.test.ts`

**Interfaces:**
- Consumes: Task 5 `nextSlot`, Task 6 `validatePanel`.
- Produces:
  - `buildJudgeMessages(setup: DebateSetup, turns: Turn[]): ModelMessage[]`
  - `parseVerdict(text: string): { winner: Side; reasoning: string } | null`: accepts a JSON object `{"winner": "for" | "against", "reasoning": string}`, optionally inside a ```` ```json ```` fence; anything else (including `"draw"`) returns `null`.
  - `judgeDebate(setup: DebateSetup, turns: Turn[], client: ModelClient): Promise<Verdict>`: throws `DebateNotFinishedError` if `nextSlot` is not null; validates the Panel; asks each Judge, retrying once on `null` parse, then throws `VerdictParseError`; returns `{ winner, reasoning, judges: setup.panel }`. `maxOutputTokens: 800`.

- [ ] **Step 1: Write the failing tests**

```ts
test('Judge prompt lists the Rubric, demands JSON and forbids a draw', () => {
  const [system] = buildJudgeMessages(setup, sixTurns);
  for (const s of ['Argument strength', 'Rebuttal quality', 'Evidence', 'Clarity', '"winner"', 'must choose'])
    expect(system.content).toContain(s);
});
test('parses plain and fenced JSON', () => {
  expect(parseVerdict('{"winner":"against","reasoning":"r"}')).toEqual({ winner: 'against', reasoning: 'r' });
  expect(parseVerdict('```json\n{"winner":"for","reasoning":"r"}\n```')).toEqual({ winner: 'for', reasoning: 'r' });
});
test('rejects draws, wrong Sides and prose', () => {
  for (const t of ['{"winner":"draw","reasoning":"r"}', '{"winner":"pro","reasoning":"r"}', 'For wins.'])
    expect(parseVerdict(t)).toBeNull();
});
test('retries once, then succeeds', async () => {
  const replies = ['nonsense', '{"winner":"for","reasoning":"clear"}'];
  const client = new FakeModelClient(() => replies.shift()!);
  expect(await judgeDebate(setup, sixTurns, client)).toEqual({ winner: 'for', reasoning: 'clear', judges: ['c/judge'] });
  expect(client.calls).toHaveLength(2);
});
test('throws VerdictParseError after two bad replies', async () => {
  await expect(judgeDebate(setup, sixTurns, new FakeModelClient(() => 'draw'))).rejects.toBeInstanceOf(VerdictParseError);
});
test('refuses to judge an unfinished Debate', async () => {
  await expect(judgeDebate(setup, sixTurns.slice(0, 5), new FakeModelClient())).rejects.toBeInstanceOf(DebateNotFinishedError);
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/engine test -- judge`

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/judging/judge*
git commit -m "feat(engine): Judge prompt, Verdict parsing and judging"
```

---

### Task 8: Oxford Swing

**Files:**
- Create: `packages/engine/src/voting/oxford.ts`
- Test: `packages/engine/src/voting/oxford.test.ts`

**Interfaces:**
- Produces:

```ts
export interface VoterStances { voterId: string; before?: Stance; after?: Stance }
export interface OxfordResult { counted: number; swing: Record<Side, number>; winner: Side | 'tie' }
export function computeOxfordResult(votes: VoterStances[]): OxfordResult;
```

Swing for a Side = (paired voters with that Side after − with that Side before) ÷ paired voters × 100, in percentage points. The winner is the Side with the larger Swing; equal Swings (including zero paired voters, where both are 0) give `'tie'`. Duplicate `voterId`s throw `DuplicateVoterError`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the Side that moved more voters wins', () => {
  // 10 paired voters: before 4 for / 4 against / 2 undecided; after 6 / 3 / 1
  const r = computeOxfordResult(tenPairedVoters);
  expect(r.counted).toBe(10);
  expect(r.swing.for).toBeCloseTo(20);
  expect(r.swing.against).toBeCloseTo(-10);
  expect(r.winner).toBe('for');
});
test('unpaired votes are ignored', () => {
  const r = computeOxfordResult([{ voterId: 'a', before: 'for' }, { voterId: 'b', after: 'against' }, { voterId: 'c', before: 'against', after: 'for' }]);
  expect(r.counted).toBe(1);
  expect(r.winner).toBe('for');
});
test('no paired voters is a tie', () => {
  expect(computeOxfordResult([])).toEqual({ counted: 0, swing: { for: 0, against: 0 }, winner: 'tie' });
});
test('duplicate voters are rejected', () => {
  expect(() => computeOxfordResult([{ voterId: 'a', before: 'for', after: 'for' }, { voterId: 'a', before: 'for', after: 'for' }])).toThrow(DuplicateVoterError);
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/engine test -- oxford`

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/voting/oxford*
git commit -m "feat(engine): Oxford Swing over paired votes"
```

---

### Task 9: AI Voters and the AI Audience Result

**Files:**
- Create: `packages/engine/src/voting/ai-voter.ts`
- Test: `packages/engine/src/voting/ai-voter.test.ts`

**Interfaces:**
- Consumes: Task 8 `computeOxfordResult`, Task 4 `ModelClient`, Task 5 `nextSlot`.
- Produces:
  - `parseStance(text: string): Stance | null`: the first word-like token, case-insensitive, must be `for`, `against` or `undecided`.
  - `castAiStance(motion: Motion, model: ModelId, client: ModelClient, turns?: Turn[]): Promise<Stance>`: without `turns` it is the before-stance (Motion only); with `turns` the after-stance (full transcript). Prompt asks for exactly one word and to answer in English regardless of Motion language. Retries once on `null`, then throws `StanceParseError`. `maxOutputTokens: 10`.
  - `runAiAudience(setup: DebateSetup, turns: Turn[], voters: ModelId[], client: ModelClient): Promise<OxfordResult>`: throws `DebateNotFinishedError` if the Debate isn't finished; each voter gets `voterId` `${index}:${model}` (the same model may appear twice).

- [ ] **Step 1: Write the failing tests**

```ts
test('parses stances leniently but strictly by word', () => {
  expect(parseStance('Against.')).toBe('against');
  expect(parseStance('undecided')).toBe('undecided');
  expect(parseStance('I think for')).toBeNull();
});
test('before-stance sees only the Motion; after-stance sees the Turns', async () => {
  const client = new FakeModelClient(() => 'for');
  await castAiStance(setup.motion, 'x/v', client);
  await castAiStance(setup.motion, 'x/v', client, sixTurns);
  expect(JSON.stringify(client.calls[0].messages)).not.toContain(sixTurns[0].text);
  expect(JSON.stringify(client.calls[1].messages)).toContain(sixTurns[0].text);
});
test('AI Audience Result is an Oxford result over all AI Voters', async () => {
  // before replies 'undecided', after replies 'against' for both voters
  const r = await runAiAudience(setup, sixTurns, ['x/v', 'x/v'], client);
  expect(r).toEqual({ counted: 2, swing: { for: 0, against: 100 }, winner: 'against' });
});
test('throws StanceParseError after two bad replies', async () => { /* replies 'maybe' */ });
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement**, **Step 4: Run to verify pass**

Run: `pnpm --filter @debate-arena/engine test -- ai-voter`

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/voting/ai-voter*
git commit -m "feat(engine): AI Voters and AI Audience Result"
```

---

### Task 10: Worst-case Budget estimate

**Files:**
- Create: `packages/engine/src/budget/estimate.ts`
- Modify: `packages/engine/src/index.ts` (export the full public API from all tasks)
- Test: `packages/engine/src/budget/estimate.test.ts`, `packages/engine/src/index.test.ts` (end-to-end)

**Interfaces:**
- Consumes: Task 5 `turnSlots`, `TOKENS_PER_WORD`; Task 3 `countWords`.
- Produces:

```ts
export interface ModelPrice { inputPerMTokUsd: number; outputPerMTokUsd: number }
export type PriceTable = Record<ModelId, ModelPrice>;
export const PROMPT_OVERHEAD_TOKENS = 600;
export const JUDGE_OUTPUT_TOKENS = 800;
export const STANCE_OUTPUT_TOKENS = 10;
export function worstCaseBudgetMicroUsd(setup: DebateSetup, aiVoters: ModelId[], prices: PriceTable): number;
```

Algorithm (every Turn at full length): `motionTokens = ceil(countWords(motion) × 1.4)`; slot `i` outputs `out_i = ceil(maxWords × 1.4)` and reads `600 + motionTokens + Σ out_j (j < i)`; each Judge reads `600 + motionTokens + Σ out` and outputs 800; each AI Voter's before-stance reads `600 + motionTokens`, after-stance reads `600 + motionTokens + Σ out`, each outputs 10. A call costs `input × inputPerMTokUsd + output × outputPerMTokUsd` micro-USD; return the ceiling of the sum. Human Debaters' slots cost nothing. A model missing from `prices` throws `UnknownModelPriceError`. Motion screening is added in Plan 5.

- [ ] **Step 1: Write the failing tests**

```ts
// every model priced at 1 USD per million tokens in and out, so micro-USD equals tokens
test('Classic Debate with one Judge', () => {
  expect(worstCaseBudgetMicroUsd(setup, [], unitPrices)).toBe(14079);
});
test('each AI Voter adds a before- and after-stance', () => {
  expect(worstCaseBudgetMicroUsd(setup, ['x/v'], unitPrices)).toBe(17133);
});
test('unknown model prices are an error', () => {
  expect(() => worstCaseBudgetMicroUsd(setup, [], {})).toThrow(UnknownModelPriceError);
});
// index.test.ts
test('runs a full Classic Debate offline', async () => {
  const client = new FakeModelClient(r => r.maxOutputTokens === 800 ? '{"winner":"for","reasoning":"ok"}' : r.maxOutputTokens === 10 ? 'for' : 'An argument.');
  const turns: Turn[] = [];
  while (nextSlot(setup.format, turns)) turns.push(await generateTurn(setup, turns, client));
  expect(turns).toHaveLength(6);
  expect((await judgeDebate(setup, turns, client)).winner).toBe('for');
  expect((await runAiAudience(setup, turns, ['x/v'], client)).counted).toBe(1);
});
```

(Setup Motion "Remote work beats office work" = 7 Motion tokens; Turn outputs 420, 420, 280, 280, 210, 210.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @debate-arena/engine test -- estimate index`
Expected: FAIL.

- [ ] **Step 3: Implement `worstCaseBudgetMicroUsd` and the public exports**

- [ ] **Step 4: Run the whole suite**

Run: `pnpm check`
Expected: oxlint 0 errors, typecheck passes, all engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): worst-case Budget estimate and public API"
```
