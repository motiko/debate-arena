# Streaming Turns — design

Viewers of a running (live) Debate see a speech appear as the Debater's model writes it, instead of the whole Turn
arriving at once when it is finished.

## What the Viewer sees

- While a Turn is being written, its seat on the floor shows the **draft**: the text so far, growing, in the
  speaking Side's colours, with its speaker heading and the AI-generated label (ADR 0005). A quiet caret marks the
  end of the text; it does not blink under `prefers-reduced-motion: reduce`.
- The draft never shows more than the Phase's word limit.
- When the Turn is finished, the stored Turn replaces the draft in the same seat (its preview and "Read the full
  speech" as today). Its last half-sentence may disappear, because a cut Turn is trimmed back to its last full
  sentence; that is expected.
- If generating the Turn fails and is retried, the draft is cleared; the retry streams a new one.
- Screen readers: drafts are not announced. The floor's live region keeps announcing each finished Turn once, as
  today. The draft is `aria-hidden`; the "speaks next" line in the seat stays readable and says "{Side} is speaking"
  while a draft is shown.
- Slow Debates (batch kind) do not stream: they have no live page (unchanged).
- A Viewer who opens the page or reconnects mid-speech sees the draft from the next draft event on (within about
  300 ms), not an empty seat.

## How

- **Draft events carry the full text so far**, not deltas, so every event is self-contained: late joiners and
  reconnects need nothing stored. The DebateRoom Durable Object is unchanged (it relays any `DebateEvent`).
- New event: `{ type: 'draft'; slotIndex: number; text: string }`. An empty `text` clears the draft.
- The consumer sends at most one draft event per **300 ms** per Turn (the latest text, trailing), and none after
  the Turn's `turn` event. Drafts are best-effort: a failed broadcast never fails a Turn.
- The engine's `ModelClient.complete` takes an optional second argument `{ onText(textSoFar) }`. Clients that cannot
  stream (Batch API) ignore it. The OpenRouter client streams (SSE) only when `onText` is given; Judge, AI Voter and
  screener calls stay non-streaming.
- `generateTurn` passes drafts cut to the Phase's word limit (`truncateToWords`), so no layer above it needs to know
  the limit.
- Cost: no extra model spend; about 30 Durable Object messages for a 300-word Turn.

## Out of scope

- Premieres (scheduled, paced reveal) — a later feature that can build on drafts.
- Streaming the Verdict or AI Voters.
