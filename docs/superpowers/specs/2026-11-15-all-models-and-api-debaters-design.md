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
- **"Make it a Slow Debate" appears only when both Debaters are batch-capable** (§1, Slow Debates) and neither bench is
  API. Changing a Debater to one that is not batch-capable hides the choice again and unticks it, announced in the
  form's status line ("Slow Debate is not available for {model}"). While it is ticked, the Judge picker lists only
  batch-capable models (and "Let the platform choose").
- Under the start button, the form shows what this line-up costs: "{points} Quota points · you have {left} left
  today", updated as choices change (from `POST /api/debates/quote`, §3).
- The CLI's `debate models` lists the same models; `debate models --search <words>` filters the same way.

### Which models are listed

The API Worker reads `GET https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=max_tokens`
(with the platform's key, though it answers without one) and keeps a model when all hold:

- text is among `architecture.input_modalities` and `architecture.output_modalities` is exactly `["text"]`;
- `pricing.prompt` and `pricing.completion` parse as numbers ≥ 0 (routers such as `openrouter/auto` report −1);
- it does not start with `openrouter/`, and its id has no variant suffix other than `:free` (`:batch` variants are not
  models of their own, see below; other variants such as `:nitro` or `:thinking` are left out);
- it costs tokens only, by an allowlist of pricing keys: non-zero cache, `web_search` (the plugin, never requested),
  image and audio prices are tolerated, since a Debate never incurs them; a dearer `internal_reasoning` price becomes
  the output price; time-of-day `overrides` count at their highest price; a long-context override is tolerated
  only from 32 000 prompt tokens (a Debate's prompts stay near 11 000). Any other non-zero key, or an override with
  an unknown condition, drops the model, as the meter and the Budget would not see that fee. A model with built-in
  search (`web_search_options` among its parameters, e.g. Perplexity's) may search, paying per search, on any call:
  for it a non-zero `web_search` price is such a fee, and drops it;
- `supported_parameters` includes `max_tokens`;
- `context_length` ≥ 16 000 (a Classic Debate's Judge prompt is about 5 000 tokens).

Expensive models are listed too; they cost more Quota (§3).

**Free models.** A `:free` variant (14 on 2026-11-15, e.g. `google/gemma-4-31b-it:free`) is listed as its own entry,
labelled "{name} (free)", at price 0. OpenRouter rate-limits free variants per account, so they share one platform-wide
allowance: a free Debater that is refused fails its Debate, which costs nothing and so refunds the Quota (the
existing rule). OpenRouter serves free variants only when the account allows providers that may keep prompts; the
platform's account must allow that (a deploy step), which is acceptable because every Turn is public anyway.

On 2026-11-15 that is 356 models (342 + 14 free). Prices are USD per token in the response; the catalog stores USD per million
tokens, as today. A `<id>:batch` entry in the response becomes the base model's `batchPrice`.

**Slow Debates.** A model is **batch-capable** when it has a `batchPrice` and its reasoning is not `'mandatory'`
(51 models on 2026-11-15; no free model). A Slow Debate needs both Debaters and its Judge batch-capable; the API
refuses others with 400 "Model {id} cannot take part in a Slow Debate", as today.

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
none, the curated catalog alone. A request never waits more than 3 s for the list, and after a failed fetch the
fallback is served from memory for a minute before OpenRouter is asked again, so an outage does not slow every request.

**Prices are frozen per Debate.** A Debate stores, at start, the price and reasoning setting of every model it
will call (Debaters, Judge, AI Voters, screener). Its steps charge and call by that snapshot, so a model that
leaves OpenRouter's list or changes price mid-Debate can neither go unmetered nor change the reserved Budget.
Debates started before this change fall back to the catalog, as today.

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
  the server reads it as it arrives (today Cloudflare hands it over only once complete, see below). The Turn ends
  when the body ends.
- **Stored Turn:** the text, trimmed, cut at the Phase's word limit and then back to its last full sentence when
  cut (as an AI Turn), `truncated` set accordingly. It is also cut at 8 bytes per word of the Phase (2 400 bytes
  for an Opening), never inside a character: the Budget reserves every later call's reading of an API Turn at that
  size (bytes bound tokens), so text padded with symbols cannot spend past the reserve. Bodies over 64 KiB are
  refused with 413 and nothing is stored.
- **Only once awaited:** a Turn is accepted only after the step has set its slot's deadline (the `awaiting` event).
  Sent earlier, it gets 409, so exactly one step job moves the Debate on and the next AI Turn is paid for once.
- **Verified 2026-11-15: Cloudflare buffers request bodies.** A throwaway Worker received a body sent in six pieces a
  second apart (Node `fetch` with `duplex: 'half'`, and `curl -T -`) as one chunk, at 0 ms, after the upload ended.
  So a streamed body works but shows no drafts. **Live drafts come from
  `PUT /api/debates/:id/turns/:slot/draft`** with the text so far as a `text/plain` body (204; same auth, slot and
  size rules; each call is relayed as one `draft` event, cut to the word limit), which `debate speak` sends at most
  every 300 ms while it reads stdin, before its final POST. Any client can do the same.
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

## 3. Quota follows cost

Today every Debate costs 2 of a Member's 6 daily Quota points and a Slow Debate 1, whatever its models cost. With
every model on offer that no longer fits: on 2026-11-15 a Debate's worst-case Budget ranges from about $0.002 (two
free Debaters) to over $2.

**A Debate costs Quota in proportion to its worst-case Budget**, the amount already reserved before it starts:

- `QUOTA_POINT_MICRO_USD = 12_500`: one point per 1.25 cents of worst-case Budget, rounded up, at least 1.
- `DAILY_QUOTA_POINTS = 24` (was 6). A Member can spend at most $0.30 of worst-case Budget a day, about what three of
  today's dearest curated Debates reserve.
- A Debate that would cost more than 24 points (worst case over $0.30) cannot be started by a Member with limited
  Quota: 400 "This line-up needs {points} Quota points; a day has 24. Choose cheaper models or leave out AI Voters."
- `BATCH_DEBATE_QUOTA_POINTS` and the fixed `DEBATE_QUOTA_POINTS` go away. A Slow Debate is cheaper because its
  Budget is reckoned at batch prices.
- Members with unlimited Quota spend no points. A safety ceiling `MAX_DEBATE_BUDGET_MICRO_USD = 5_000_000` ($5)
  still applies to everyone, so a mistake cannot cost more than that.

**What counts.** Everything the Debate pays for counts, by the same rule, because it is all in the worst-case
Budget:

- **Debaters**: their Turns, at their price; free and API Debaters cost nothing.
- **The Judge**: one verdict call over the whole transcript. A platform-chosen Judge is a cheap curated model, so it
  adds about a point. A Member-chosen expensive Judge costs what it costs.
- **AI Voters**: ten curated models, two short calls each. They reserve about $0.038, roughly 3 points. That is
  more than a cheap Debate's Turns, so a Member who adds them sees the price go up before starting.
- **Screening**: the Motion, and each API Turn: a fraction of a point.

Examples at 2026-11-15 prices (worst case, live):

| Line-up | Budget | Points |
| --- | --- | --- |
| Two free Debaters, platform Judge | $0.002 | 1 |
| Claude Haiku 5.5 vs Qwen 3.8 Flash, platform Judge | $0.020 | 2 |
| GPT-6.1 Terra vs DeepSeek V4.1 Flash, platform Judge | $0.042 | 4 |
| the same, with AI Voters | $0.080 | 7 |
| GPT-6.1 Terra vs DeepSeek, as a Slow Debate | ≈$0.019 | 2 |

**The rule in one place.** `quotaPointsFor(budgetMicroUsd: number): number` lives in the engine's Budget module, so
the API and the web compute the same number. The API is the authority.

**Quoting before starting.** `POST /api/debates/quote` takes the same body as `POST /api/debates` and answers 200
`{ budgetMicroUsd, quotaPoints, quotaRemaining, slowAvailable, panel, selfJudging }`, or the same 400 errors, without
charging or creating anything. `slowAvailable` is true when both Debaters are batch-capable. It is open to the same
callers as starting a Debate (session or API token), and the CLI prints it on `debate start --dry-run`.

**Refunds** are unchanged: a failed Debate that charged no model cost gets its points back.

## Out of scope

- Handing a seat to someone other than the starting Member (per-seat tokens), or a human typing Turns on the web.
- Phase time limits (`maxSeconds`) for API Turns; the deadline is one fixed 10 minutes.
- Submitting Turns over WebSocket; an SSE stream of events for non-WebSocket clients.
- Choosing AI Voters or the screener from the full catalog.
