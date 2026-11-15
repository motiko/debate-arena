# Streaming Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Viewers of a live Debate see each speech grow as the Debater's model writes it; the stored Turn replaces the draft when it is finished.

**Architecture:** The engine's `ModelClient.complete` gains an optional `onText` callback; the OpenRouter client streams (SSE) only when it is given. `generateTurn` reports drafts cut to the Phase's word limit; the step runner throttles them into `draft` events (full text so far, ≤ one per 300 ms) that the existing DebateRoom relays unchanged. The live island keeps one draft and shows it, `aria-hidden`, in the speaking seat until the `turn` event replaces it.

**Tech Stack:** TypeScript, Cloudflare Workers (Queues, Durable Objects), OpenRouter chat completions SSE, Astro + Svelte 5, Vitest (+ `@cloudflare/vitest-pool-workers` for the API), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-streaming-turns-design.md`

## Global Constraints

- Draft event shape, verbatim: `{ type: 'draft'; slotIndex: number; text: string }`; `text: ''` clears the draft.
- Drafts carry the full text so far, never deltas. At most one draft event per `DRAFT_INTERVAL_MS = 300` per Turn; none after that Turn's `turn` event.
- A draft never exceeds the Phase's `maxWords` (cut with the engine's `truncateToWords`).
- Drafts are best-effort: a failed draft broadcast never fails or retries a step.
- Slow Debates (`kind: 'batch'`) never stream; Judge, AI Voter and screener calls never stream.
- The DebateRoom Durable Object does not change.
- Copy (en.ts): `'floor.speaking': '{side} is speaking'`. No other new strings.
- The draft is `aria-hidden="true"`; finished Turns are announced by the existing `role="log"` region exactly as today.
- No `{@html}` anywhere (TurnItem renders text runs, as now).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; no "Generated with Claude Code" line in the PR.

## Review Focus

- A `draft` event that arrives after its Turn's `turn` event (or for an already-finished slot) must be ignored, not resurrect a draft under a finished speech — test in Task 5 (`applyDraft`).
- A Viewer who reconnects mid-speech: `catchUp` may add the Turn the draft belongs to; the stale draft must go — test in Task 5 (LiveTurns).
- A model stream that sends reasoning deltas, OpenRouter comment lines or keep-alive blanks must show none of them as speech — test in Task 2.
- A step that fails mid-stream after drafts were sent must clear the draft before the error propagates — test in Task 4.
- A Moderator Block while a draft shows must clear it with the Turns — test in Task 5 (LiveTurns).

---

### Task 1: Engine — streaming in the model contract and in `generateTurn`

**Files:**
- Modify: `packages/engine/src/models/client.ts`, `packages/engine/src/models/fake.ts`, `packages/engine/src/debate/generate-turn.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/models/fake.test.ts` (create if absent), `packages/engine/src/debate/generate-turn.test.ts`

**Interfaces:**
- Produces:
  - `interface CompleteOptions { onText?: (textSoFar: string) => void }` (exported from the engine index)
  - `ModelClient.complete(request: ModelRequest, options?: CompleteOptions): Promise<ModelResponse>`
  - `generateTurn(setup, priorTurns, client, options?: { onDraft?: (text: string) => void }): Promise<Turn>`
  - `FakeModelClient` calls `onText` once per word with the cumulative text (`"A"`, `"A fake"`, …), before resolving.

- [ ] **Step 1: Write the failing tests**

```ts
// fake.test.ts
test('streams the reply word by word, cumulatively, when asked', async () => {
  const seen: string[] = [];
  const reply = await new FakeModelClient(() => 'One two three.').complete(request, { onText: t => seen.push(t) });
  expect(seen).toEqual(['One', 'One two', 'One two three.']);
  expect(reply.text).toBe('One two three.');
});

// generate-turn.test.ts
test('reports drafts as the Turn is written, cut to the Phase word limit', async () => {
  const drafts: string[] = [];
  const long = Array.from({ length: 320 }, (_, i) => `w${i}`).join(' ') + '.';
  await generateTurn(setup, [], new FakeModelClient(() => long), { onDraft: d => drafts.push(d) });
  expect(drafts.length).toBeGreaterThan(1);
  expect(countWords(drafts.at(-1)!)).toBe(300); // Opening maxWords
  expect(drafts.every(d => countWords(d) <= 300)).toBe(true);
});

test('without onDraft, asks the client without a stream', async () => {
  const client = new FakeModelClient();
  const spy = vi.spyOn(client, 'complete');
  await generateTurn(setup, [], client);
  expect(spy.mock.calls[0]?.[1]).toBeUndefined();
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/engine test` (onText/onDraft unknown).
- [ ] **Step 3: Implement.** Add `CompleteOptions` and the optional parameter in `client.ts`. In `FakeModelClient.complete`, when `options?.onText` is set, call it for each whitespace-separated word prefix of the reply (joining with the original spacing via `text.slice(0, end)`). In `generateTurn`, pass `{ onText: soFar => onDraft(truncateToWords(soFar.trimStart(), phase.maxWords).text) }` only when `onDraft` is given; skip calling `onDraft` for an empty draft. Export `CompleteOptions` from `index.ts`.
- [ ] **Step 4: Run, expect PASS** — engine tests and `pnpm --filter @debate-arena/engine typecheck`.
- [ ] **Step 5: Commit** — `feat(engine): stream Turn drafts through an optional onText callback`.

### Task 2: OpenRouter client — streaming when `onText` is given

**Files:**
- Create: `apps/api/src/models/sse.ts`
- Modify: `apps/api/src/models/openrouter.ts`
- Test: `apps/api/test/sse.test.ts`, `apps/api/test/openrouter.test.ts`

**OpenRouter facts (docs read 2026-11-15: openrouter.ai/docs/api/reference/streaming, …/chat/send-chat-completion-request, …/guides/usage-accounting):**
- Request: the usual body plus `stream: true`. Usage needs no flag (`stream_options.include_usage` is deprecated, no effect).
- Wire: `data: <json>` lines, ending `data: [DONE]`; keep-alive comment lines start with `:` (e.g. `: OPENROUTER PROCESSING`) and must be skipped.
- Chunk: `choices[0].delta.content` (string, may be `null`/`""`) is the only text to show; `delta.reasoning` and `delta.reasoning_details` are reasoning and must never be shown. `finish_reason` is `null` while streaming, then `stop`/`length`/`content_filter`/`error`/…; it repeats on a final accounting chunk that carries `usage` (`prompt_tokens`, `completion_tokens`) just before `[DONE]`.
- Errors: before the stream, a non-2xx JSON `{ error: { code, message } }` (handled as today). Mid-stream the status stays 200 and a chunk carries a top-level `error: { code, message }` with `finish_reason: "error"`; it can be the first and only event.
- Workers: read `response.body.getReader()` with `TextDecoder#decode(value, { stream: true })` (the documented pattern); waiting on the stream costs no CPU time.

**Interfaces:**
- Consumes: `CompleteOptions` (Task 1).
- Produces:
  - `sse.ts`: `async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string>` — buffers across reads, splits on newlines, yields the payload of each `data: ` line, skips `:` comment lines and blank lines, stops at `[DONE]`.
  - `OpenRouterModelClient.complete(request, options?)`: with `options.onText`, sends `stream: true` and reads the stream; without it, behaves exactly as today (no `stream` key).

- [ ] **Step 1: Write the failing tests**

```ts
// sse.test.ts — a ReadableStream built from string chunks
test('yields data payloads, joining a line split across reads', ...);     // ['data: {"a"', ':1}\n\n', 'data: [DONE]\n\n'] → ['{"a":1}']
test('skips comments and blank lines, and stops at [DONE]', ...);         // ': OPENROUTER PROCESSING\n\n' yields nothing; nothing after [DONE]
test('decodes a multi-byte character split across reads', ...);           // 'é' bytes split over two chunks → intact

// openrouter.test.ts — stub returns an SSE body (content-type text/event-stream)
test('streams: reports cumulative text, returns the whole reply with usage and finish reason', async () => {
  // chunks: delta {role, content: ""}, delta.content "Hello", a chunk with only delta.reasoning "thinking",
  // delta.content " world", finish_reason "length" (empty delta), the accounting chunk repeating
  // finish_reason "length" with usage { prompt_tokens: 12, completion_tokens: 2 }, then [DONE]
  expect(seen).toEqual(['Hello', 'Hello world']);
  expect(reply).toEqual({ text: 'Hello world', inputTokens: 12, outputTokens: 2, finishReason: 'length' });
  expect(JSON.parse(sent[0]!.body)).toMatchObject({ stream: true });
});
test('a mid-stream error chunk throws OpenRouterError with its message', ...); // 200; text so far, then {error:{code:502,message:'Provider disconnected unexpectedly'}, choices:[{delta:{content:''},finish_reason:'error'}]}
test('an error as the first and only chunk is a failure, not an empty reply', ...);
test('a stream without usage is charged the worst case', ...);           // outputTokens === request.maxOutputTokens
test('a non-2xx reply to a stream request throws as today', ...);         // 429 JSON body → OpenRouterError status 429
test('without onText, sends no stream key', ...);
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/api test -- sse openrouter`.
- [ ] **Step 3: Implement.** Streaming path in `complete`: same request body plus `stream: true`; a non-OK status is handled as today (JSON error body). Read `sseData(response.body)`, `JSON.parse` each payload as `StreamChunk = { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; usage?: CompletionBody['usage']; error?: OpenRouterErrorBody }`. Append only non-empty `delta.content` and call `onText(text)` after each append. A top-level `error` or `finish_reason === 'error'` throws `OpenRouterError` (status `error.code ?? null`) with `describeError`. Keep the last non-null `finish_reason` and the `usage` from the chunk that has it. Build the result through the same worst-case-usage rule as `readCompletion` (factor that rule into one helper both use; `finish_reason` other than `length` maps to `'stop'`, as today).
- [ ] **Step 4: Run, expect PASS** — API tests and `pnpm --filter @debate-arena/api typecheck`.
- [ ] **Step 5: Commit** — `feat(api): stream OpenRouter replies when the caller wants drafts`.

### Task 3: Pass-through — metered client and the local slow fake

**Files:**
- Modify: `apps/api/src/models/factory.ts`
- Test: `apps/api/test/factory.test.ts`

**Interfaces:**
- Consumes: `CompleteOptions` (Task 1).
- Produces: `meteredClient(...).complete(request, options?)` forwards `options` unchanged. `DevFakeModelClient` for `fake-slow/` models spreads `SLOW_FAKE_DELAY_MS` over the streamed words (one `onText` per word, delay ÷ word count between them); other models keep today's behaviour.

- [ ] **Step 1: Write the failing tests**

```ts
test('the metered client passes drafts through and still charges the reply', async () => { ... expect(seen.at(-1)).toBe(reply.text); expect(costs).toHaveLength(1); });
test('the local slow fake streams its reply over SLOW_FAKE_DELAY_MS', async () => { vi.useFakeTimers(); ... expect(seen.length).toBeGreaterThan(3); });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the pass-through and the paced fake stream. Give the dev fake Debater reply enough words to watch (about 40) so a local live Debate visibly streams; keep the Judge/Voter/screener fakes unchanged.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(api): pass drafts through the metered client; stream the local slow fake`.

### Task 4: Draft events from the step runner

**Files:**
- Create: `apps/api/src/live/drafts.ts`
- Modify: `apps/api/src/live/events.ts`, `apps/api/src/debates/steps.ts`
- Test: `apps/api/test/drafts.test.ts`, `apps/api/test/steps.test.ts`

**Interfaces:**
- Consumes: `generateTurn(..., { onDraft })` (Task 1).
- Produces:
  - `DebateEvent` gains `{ type: 'draft'; slotIndex: number; text: string }` (re-exported to the web through `@debate-arena/api-client` as today).
  - `export const DRAFT_INTERVAL_MS = 300;`
  - `createDraftSender(send: (text: string) => Promise<void>, intervalMs = DRAFT_INTERVAL_MS): { push(text: string): void; stop(): Promise<void> }` — sends the first push at once, then at most one send per interval carrying the latest text (trailing send for the last push); `stop()` cancels any pending send and waits for one in flight; send errors are swallowed.

- [ ] **Step 1: Write the failing tests**

```ts
// drafts.test.ts (vi.useFakeTimers)
test('sends the first draft at once, then the latest text at most every 300 ms', ...); // push a, ab, abc within 100 ms → sends ['a'], then after 300 ms ['a','abc']
test('stop() drops a pending draft and waits for one in flight', ...);
test('a failing send is swallowed', ...);

// steps.test.ts
test('a live Turn sends draft events before its turn event, none after', async () => {
  // client streams 'One two three.'; DRAFT_INTERVAL_MS irrelevant with an immediate first send
  const kinds = events.map(e => e.type);
  expect(kinds.indexOf('draft')).toBeLessThan(kinds.indexOf('turn'));
  expect(kinds.slice(kinds.indexOf('turn') + 1)).not.toContain('draft');
  expect(events.find(e => e.type === 'draft')).toMatchObject({ slotIndex: 0 });
});
test('a Turn that fails mid-stream clears its draft, then rethrows', async () => {
  // client: onText('Half a'), then throws
  await expect(runStep(deps, job)).rejects.toThrow();
  expect(events.at(-1)).toEqual({ type: 'draft', slotIndex: 0, text: '' });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `runStep`'s Turn branch: create a sender whose `send` is `text => notify(id, { type: 'draft', slotIndex, text })`; call `generateTurn(setup, turns, client, { onDraft: sender.push })`; `await sender.stop()` before `appendTurn`. On a throw from `generateTurn`: `await sender.stop()`, then — if any draft was pushed — `await notify(id, { type: 'draft', slotIndex, text: '' })`, then rethrow. The batch path needs nothing: its `notify` is a no-op and the deferred client ignores `onText`.
- [ ] **Step 4: Run, expect PASS** — API tests and typecheck.
- [ ] **Step 5: Commit** — `feat(api): send throttled Turn drafts to live Viewers`.

### Task 5: Web — show the draft in the speaking seat

**Files:**
- Modify: `apps/web/src/lib/debate.ts`, `apps/web/src/islands/LiveTurns.svelte`, `apps/web/src/islands/PhaseFloor.svelte`, `apps/web/src/islands/TurnItem.svelte`, `apps/web/src/i18n/en.ts`
- Test: `apps/web/test/debate.test.ts`, `apps/web/test/live-turns.test.ts`, `apps/web/test/phase-floor.test.ts`, `apps/web/test/turn-item.test.ts`

**Interfaces:**
- Consumes: the `draft` event (Task 4).
- Produces:
  - `type Draft = { slotIndex: number; text: string }`
  - `applyDraft(current: Draft | null, event: Draft, finished: number): Draft | null` — `null` when `event.text === ''` or `event.slotIndex !== finished` (only the next slot may hold a draft); otherwise `event`.
  - `PhaseFloor` prop `draft?: Draft | null`; `TurnItem` prop `draft?: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// debate.test.ts
test('applyDraft keeps a draft only for the next slot, and clears on empty text', () => {
  expect(applyDraft(null, { slotIndex: 2, text: 'Hi' }, 2)).toEqual({ slotIndex: 2, text: 'Hi' });
  expect(applyDraft({ slotIndex: 2, text: 'Hi' }, { slotIndex: 1, text: 'late' }, 2)).toBeNull();  // finished slot: stale
  expect(applyDraft({ slotIndex: 2, text: 'Hi' }, { slotIndex: 2, text: '' }, 2)).toBeNull();
  expect(applyDraft(null, { slotIndex: 3, text: 'gap' }, 2)).toBeNull();
});

// turn-item.test.ts
test('a draft shows all of its text, no disclosure, no cut note, and a caret', ...); // container.querySelector('details') null; '.caret' present; article has class speech-draft

// phase-floor.test.ts
test('a draft sits in the speaking seat, hidden from assistive tech; the seat line says who is speaking', () => {
  render(PhaseFloor, { format, speakers, turns: [turn(0, 'for')], next: { phaseIndex: 0, side: 'against' }, draft: { slotIndex: 1, text: 'Madam Chair' } });
  const draft = document.querySelector('.speech-draft')!;
  expect(draft.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.getAllByRole('article')).toHaveLength(1); // the draft is not in the accessibility tree
  expect(screen.getByText('Against is speaking')).toBeInTheDocument();
});

// live-turns.test.ts (FakeSocket)
test('shows a draft, then replaces it with the finished Turn', ...);
test('a draft for a Turn that catch-up already loaded is dropped', ...);
test('a Block clears the draft with the Turns', ...);
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/web test`.
- [ ] **Step 3: Implement.**
  - `LiveTurns`: `let draft = $state<Draft | null>(null)`; on `draft` events `draft = applyDraft(draft, event, turns.length)`; after every `add(...)` and in `blocked()`, drop a draft whose `slotIndex < turns.length` (or all, on Block). Pass `draft` to `PhaseFloor`.
  - `PhaseFloor`: in the section whose `next` slot equals `draft.slotIndex`, render `<div class="seat seat-{side}" aria-hidden="true"><TurnItem … text={draft.text} truncated={false} draft /></div>` before the `.next` line; the `.next` line reads `t('floor.speaking', …)` and gets `visually-hidden` while a draft shows.
  - `TurnItem` with `draft`: every paragraph shown (no `previewLength`, no `<details>`), no cut note, class `speech-draft`, a `<span class="caret" aria-hidden="true">` after the last run; the caret blinks only under `prefers-reduced-motion: no-preference`.
  - `en.ts`: add `'floor.speaking': '{side} is speaking'`.
- [ ] **Step 4: Run, expect PASS** — web tests and `pnpm --filter @debate-arena/web typecheck`.
- [ ] **Step 5: Commit** — `feat(web): show a speech as it is written`.

### Task 6: End to end, and the helper's name

**Files:**
- Modify: `apps/web/e2e/helpers.ts`, `apps/web/e2e/live.spec.ts` (and any spec passing `{ slow: true }`)
- Test: `apps/web/e2e/live.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5 running locally on the fake models.
- Produces: `startDebate(request, { paced: true })` — renamed from `slow`, since "Slow Debate" now names the batch kind.

- [ ] **Step 1: Write the failing test**

```ts
test('a speech grows as it is written, then the finished Turn takes its place', async ({ page, request }) => {
  const { id } = await startDebate(request, { paced: true });
  await page.goto(`/debates/${id}`);
  const draft = page.locator('.speech-draft');
  await expect(draft).toBeVisible({ timeout: 20_000 });
  const first = (await draft.textContent())!.length;
  await expect.poll(async () => (await draft.textContent())?.length ?? 0).toBeGreaterThan(first);
  await expect(page.getByRole('log').getByRole('article')).toHaveCount(2, { timeout: 20_000 });
  await expectNoAxeViolations(page); // with a draft on screen
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @debate-arena/web build && pnpm --filter @debate-arena/web e2e -- live`.
- [ ] **Step 3: Rename `slow` → `paced`** in the helper and its callers (comment: "the fake-slow Debater keeps it live for ~10 s"); nothing else should be needed if Tasks 1–5 are right.
- [ ] **Step 4: Run, expect PASS** — the whole e2e suite (`pnpm --filter @debate-arena/web e2e`).
- [ ] **Step 5: Commit** — `test(e2e): a live speech streams, then settles; rename the paced helper`.
