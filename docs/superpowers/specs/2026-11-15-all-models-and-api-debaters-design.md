# All OpenRouter models and API Debaters — design

Two changes to how a Member seats a Debate:

1. **Every usable OpenRouter model** can be a Debater or the Judge, not only the seven curated ones, and the
   pickers get a search box.
2. A bench can be given to an **API Debater**: the platform waits for each of that Side's Turns to arrive through
   the API instead of generating them. The endpoint accepts a Turn streamed in pieces, and Viewers see it grow live
   exactly as an AI Turn streams today.

## 1. The live model catalog

### What the Member sees

- On `/new`, each bench and the Judge field is a **searchable picker** (an ARIA combobox), not a `<select>`. Typing
  filters by model name, id and provider; every word typed must match (case-insensitive). Each option shows the
  model's name, provider and price ("$0.10 / $0.50 per M tokens"). Up to 50 matches are listed, then "Type to narrow
  down {count} more models".
- The Debater pickers list **API** first, before any model (see §2). The Judge picker lists "Let the platform
  choose (recommended)" first, as today.
- A Slow Debate still lists only batch-capable models.
- The CLI's `debate models` lists the same models; `debate models --search <words>` filters the same way.

### Which models are listed

The API Worker reads `GET https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=max_tokens`
(with the platform's key, though it answers without one) and keeps a model when all hold:

- text is among `architecture.input_modalities` and `architecture.output_modalities` is exactly `["text"]`;
- `pricing.prompt` and `pricing.completion` parse as numbers ≥ 0 (routers such as `openrouter/auto` report −1);
- its id has no `:` variant suffix and does not start with `openrouter/` (`:free` variants are rate-limited to the
  point of failing Debates; `:batch` variants are not models of their own, see below);
- `supported_parameters` includes `max_tokens`;
- `context_length` ≥ 16 000 (a Classic Debate's Judge prompt is about 5 000 tokens).

Expensive models are listed too; whether a chosen line-up fits the Budget cap is checked on start.

On 2026-11-15 that is 342 models. Prices are USD per token in the response; the catalog stores USD per million
tokens, as today. A `<id>:batch` entry in the response becomes the base model's `batchPrice`, so every model
OpenRouter serves through its Batch API can take part in a Slow Debate.

**Reasoning.** `reasoning.mandatory: false` (or no `reasoning` field with `reasoning` in `supported_parameters`)
→ `'optional'`, switched off as today. No `reasoning` support → `'unsupported'`. `reasoning.mandatory: true` →
`'mandatory'`: such a model is now allowed. Its calls ask for its least reasoning (the last entry of
`reasoning.supported_efforts`, else `"low"`) and add a **reasoning allowance** of `REASONING_ALLOWANCE_TOKENS = 2048`
to `max_tokens`. OpenRouter bills reasoning as output and counts it against `max_tokens`
(https://openrouter.ai/docs/use-cases/reasoning-tokens), so `max_tokens` still bounds the cost, and the worst-case
Budget counts the allowance as output on every call to that model. If reasoning still crowds out the speech, the
Turn ends short and is marked cut, as any Turn that hits its token cap. The Phase's word limit cuts the Turn as
today.

**Curated entries stay.** The seven curated entries keep their labels, their verified reasoning setting and their
roles: they alone are AI Voters and the screener, and the platform's suggested Judge is chosen from them, so a
Member who does not choose gets the same Debate as today. Every listed model may be a Debater or the Judge.

**Caching and failure.** The parsed catalog (about 60 KB) is cached for one hour in D1 (one row) and in memory per
Worker isolate. Not the Cache API: it does nothing on a workers.dev address, where production runs
(https://developers.cloudflare.com/workers/runtime-apis/cache/), and KV would be a new binding for one value. If
OpenRouter cannot be reached or answers with something unreadable, the last cached copy is used, however old; with
none, the curated catalog alone. A request never waits more than 3 s for the list.

**Prices are frozen per Debate.** A Debate stores, at start, the price and reasoning setting of every model it
will call (Debaters, Judge, AI Voters, screener). Its steps charge and call by that snapshot, so a model that
leaves OpenRouter's list or changes price mid-Debate can neither go unmetered nor change the reserved Budget.
Debates started before this change fall back to the catalog, as today.

### Budget cap

Some models make one Debate cost dollars (on 2026-11-15, a Classic Debate on `openai/gpt-5.5-pro` reserves about
$2.19). Starting a Debate whose worst-case Budget exceeds `MAX_DEBATE_BUDGET_MICRO_USD = 1_000_000` ($1) is
refused with 400: "This line-up could cost up to ${cost}; a Debate may reserve at most $1.00. Choose cheaper
models." Members with unlimited Quota (`UNLIMITED_QUOTA_GITHUB_IDS`) are exempt. The form shows each option's
price so a Member can see why.

## 2. API Debaters

### Model

- New Debater kind: `{ kind: 'api' }`. Its Turns are submitted by **the Member who started the Debate**, through the
  API with one of their API tokens. Whether a person types them or the Member's own program writes them is the
  Member's business; the platform does not claim either.
- In `POST /api/debates`, a bench is given to an API Debater with the reserved value `"api"`:
  `{ "debaters": { "for": "api", "against": "anthropic/claude-haiku-5.5" } }`. Both benches may be `"api"`.
- An API Debater costs no model Budget (each of its Turns is screened, see below). The Debate costs the same Quota.
- Slow Debates cannot have an API Debater (400: "A Slow Debate cannot have an API Debater").
- Self-Judging and the suggested Judge consider only AI Debaters, as today.

### Waiting for a Turn

- When the next slot belongs to an API Debater, the step does not generate it: it records the slot's **deadline**
  (`now + API_TURN_TIMEOUT_SECONDS`, 600 s) and tells Viewers with a new live event
  `{ type: 'awaiting'; slotIndex: number; deadline: string }`. The Debate view gains
  `awaiting: { slotIndex: number; side: Side; deadline: string } | null`.
- A deadline check is queued with the same delay. If the slot is still empty when it runs, the Debate fails
  (internal reason "API Debater missed the deadline for slot {n}"); Viewers see the usual failure message. The
  Quota is refunded only if no model cost was charged, as for every failure.
- Once the Turn is stored, the Debate moves on exactly as after an AI Turn.

### Submitting a Turn — `POST /api/debates/:id/turns/:slot`

- **Auth:** an API token (`Authorization: Bearer`) of the Member who started the Debate. A session cookie is not
  accepted, because a `text/plain` body is a CORS "simple request" and a cross-site form could send one with a
  cookie. 401 without a valid token, 403 for another Member's Debate.
- **Body:** `Content-Type: text/plain; charset=utf-8`: the Turn's text. It may be sent all at once, or **streamed**
  (chunked upload, e.g. `fetch(url, { body: stream, duplex: 'half' })`, or `curl -T -`). While the body arrives,
  Viewers see the Turn so far as `draft` events, under the same rules as AI drafts (full text so far, at most one
  per 300 ms, cut to the Phase's word limit, at most `MAX_DRAFTS_PER_TURN`). The Turn ends when the body ends.
- **Stored Turn:** the text, trimmed, cut at the Phase's word limit and then back to its last full sentence when
  cut (as an AI Turn), `truncated` set accordingly. Bodies over 64 KiB are refused with 413 and nothing is stored.
- **To be verified first:** whether Cloudflare hands the Worker a request body while it is still arriving, or
  buffers it (no official doc says; an older report says it buffered). Plan Task 0 checks this with a throwaway
  Worker. **If it buffers**, the streamed body still works but shows no drafts, and live drafts come instead from
  `PUT /api/debates/:id/turns/:slot/draft` with the text so far as a `text/plain` body (204; same auth and slot
  rules; each call is relayed as one `draft` event, cut to the word limit), which `debate speak` sends at most
  every 300 ms while it reads stdin, before its final POST.
- **Answers:** 201 `{ slotIndex, turn }`; 400 empty Turn; 404 no such Debate; 409 when `:slot` is not the slot the
  Debate is waiting for (already written, not yet reached, an AI's slot, or the Debate is not running); 410 Blocked.
  A body that is cut off (the client disconnects) stores nothing and clears the draft; the slot stays open until
  its deadline.
- **Two submissions for the same slot:** the first to finish is stored; the other gets 409. Their drafts may
  interleave meanwhile (one Member, two clients: acceptable).
- **Screening:** each stored API Turn is screened by the screener (a normal call, charged to the Debate's Budget,
  which reserves one screen per API slot). A Flag Unlists the Debate, as for a Motion; it never removes anything.
  A failed screen counts as unscreened, which Flags.

### What Viewers see

- The bench shows "API Debater" where it shows a model's name.
- An API Turn is labelled **"Submitted via API"** instead of "AI-generated" (ADR 0005 labels what the platform's
  AI generated; it cannot know how an API Turn was written).
- While waiting, the seat says "{Side} is preparing a Turn via the API" and, after the deadline passes without a
  Turn, the failure message as today. While its draft streams, "{Side} is speaking", as for AI.

### The CLI

- `debate start <motion> --for api --against <model>` starts it and, unless `--detach`, follows it live.
- `debate speak <id>` submits the Turn the Debate is waiting for, reading it from stdin and **streaming it as it is
  read**, so `my-agent | debate speak <id>` shows the speech live. It reads the Debate first to learn the awaited
  slot; it fails with the API's message on 409. `--slot <n>` overrides the slot.
- `debate show <id>` and following print "Waiting for {side}'s Turn via the API until {time}" on `awaiting`.

## Out of scope

- Handing a seat to someone other than the starting Member (per-seat tokens), or a human typing Turns on the web.
- Phase time limits (`maxSeconds`) for API Turns; the deadline is one fixed 10 minutes.
- Submitting Turns over WebSocket; an SSE stream of events for non-WebSocket clients.
- Choosing AI Voters or the screener from the full catalog.
