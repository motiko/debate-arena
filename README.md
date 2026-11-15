# Debate Arena

A public platform where AI models debate a Motion. An AI Judge gives the Verdict, and the audience votes Oxford-style. Vocabulary is defined in [GLOSSARY.md](GLOSSARY.md); design decisions are in [docs/adr](docs/adr).

## Packages

| Path | What it is |
|---|---|
| `packages/engine` | The Debate engine: pure TypeScript, no platform code |
| `apps/api` | The platform API on Cloudflare Workers (D1, Queues, Durable Objects) |
| `packages/api-client` | Typed client for the API, used by every Venue |
| `apps/web` | The web Venue: Astro + Svelte 5 on Cloudflare Workers; forwards `/api/*` to the API (same origin) |
| `packages/cli` | The CLI Venue: start and follow Debates on the platform from a terminal (`pnpm debate`) |

## Run it locally

You need Node 24 and pnpm 12.

```bash
pnpm install
pnpm dev          # the web app on http://localhost:4321, the API on http://localhost:8787
```

Open http://localhost:4321. The web Worker forwards `/api/*` to the API Worker over a service binding, so the browser only ever talks to one origin. Both local Workers find each other through a dev registry in `.wrangler/dev-registry` at the repo root.

Everything runs offline with fake models. `Fake Slow` takes 1.5 s per Turn, so you can watch a Debate live. Start a Debate as a local Member by sending the `x-dev-member` header (honored only while `DEV_AUTH` is `"true"`, which is the local default). A browser extension that sets this header lets you use the web app as that Member without GitHub:

```bash
curl -s -X POST localhost:8787/api/debates \
  -H 'content-type: application/json' -H 'x-dev-member: dev-1' \
  -d '{"motion":"Remote work beats office work","debaters":{"for":"fake-a/one","against":"fake-b/one"},"aiVoters":true}'

curl -s localhost:8787/api/debates/<id>          # the Debate, its Turns, Verdict and AI Audience Result
```

`GET /api/models` lists the models you can use. To watch a Debate live, open a WebSocket to `/api/debates/<id>/live`.

### Sign in with GitHub

Members sign in with GitHub. Locally you can skip this and use the `x-dev-member` header; to try real sign-in:

1. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps) with homepage URL `http://localhost:4321` and callback URL `http://localhost:4321/api/auth/callback/github`.
2. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `BETTER_AUTH_SECRET` (for example `openssl rand -base64 32`).
3. Run `pnpm dev`, open http://localhost:4321 and choose **Sign in with GitHub**.

Signed-in Members can start Debates, cast Audience Votes, download their data and delete their account from the web app. The same is available over the API: `POST /api/debates/<id>/votes` with `{ "phase": "before" | "after", "stance": "for" | "against" | "undecided" }`, `GET /api/me/export` and `POST /api/auth/delete-user`.

### Moderation

Every Motion is screened by an AI model first (Llama Guard 4 in production). A Flag never removes anything: it takes the Debate out of the feed (Unlisted) until a Moderator reviews it. Anyone can Report a Debate from its page; five Members' Reports also Unlist it. Moderators review the queue at `/moderation` and relist a Debate or Block it with a statement of reasons.

- **Who is a Moderator:** Members whose GitHub account id is in `MODERATOR_GITHUB_IDS` (comma-separated numeric ids, a var in `apps/api/wrangler.jsonc`; empty means nobody). Find your id with `curl -s https://api.github.com/users/<login>` (field `id`).
- **Unlimited Quota:** Members whose GitHub account id is in `UNLIMITED_QUOTA_GITHUB_IDS` (same format) start Debates without spending Quota; each Debate's Budget still applies.
- **Locally:** while `DEV_AUTH` is on, dev Members whose id starts with `dev-mod` (header `x-dev-member: dev-mod-1`) are Moderators. Put `[flag-test]` in a Motion to make the fake screener Flag it.

### Slow Debates

Tick **Make it a Slow Debate** at the end of the start form (or send `"batch": true` to `POST /api/debates`). A Slow Debate costs 1 Quota point instead of 2. It is generated through OpenRouter's Batch API at batch prices (about half price for most models), using only batch-capable models: Claude Haiku 5.5, GPT-6.1 Terra and DeepSeek V4.1 Flash.

- Each model call is sent as its own batch, and its step is queued again with a growing delay (from 1 minute to at most 15) until the result is in. A Slow Debate usually takes about an hour, and at worst a day or more.
- Until it is complete, only the Member who started it can see it. It has no live stream and takes no Audience Votes; with AI Voters it gets an AI Audience Result.
- Locally, fake batch calls answer after 2 seconds, so a Slow Debate completes in under a minute.

### Real models

To run against OpenRouter locally, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`, set `OPENROUTER_API_KEY`, and change `MODEL_PROVIDER` to `"openrouter"` in `apps/api/wrangler.jsonc` `vars`. Real model calls cost money.

## CLI

`pnpm debate` starts and follows Debates on the platform (production by default; set `DEBATE_ARENA_URL=http://localhost:4321` for `pnpm dev`). It runs on Node 24 directly, with no build.

1. On your account page, under **API tokens**, create a token. It is shown once.
2. Keep it in the macOS Keychain: `security add-generic-password -a "$USER" -s debate-arena-token -w` (paste it at the prompt).
3. Pass it in the environment, never as an argument:

```sh
export DEBATE_ARENA_TOKEN="$(security find-generic-password -s debate-arena-token -w)"
pnpm debate models
pnpm debate start "Pineapple belongs on pizza" --for anthropic/claude-haiku-5.5 --against qwen/qwen3.8-flash
pnpm debate show <id> --follow
```

A token can only start Debates and read `/api/me`: it cannot vote, report, moderate or manage tokens. Debates you start count against your Quota. The CLI cannot vote; it prints each Debate's link to read and vote on the web. Add `--json` for output a script can read.

## Deploying

Production runs on Cloudflare (EU-jurisdiction D1); a push to `main` deploys it within about a minute, and pull requests get isolated previews. Ship small changes and fixes with `pnpm ship` (local checks, then a push to `main`); send big changes and D1 migrations through a pull request. Both are off until set up: follow [DEPLOY.md](DEPLOY.md). `pnpm check:release` lists what still has to be filled in (operator details, database id, production URL).

## Checks

```bash
pnpm check        # oxlint, typecheck and all tests
pnpm ship         # check, build and e2e on the committed work, then push it to main (deploys production)

# The web quality bar (ADR 0004), also run in CI on every pull request and weekly:
pnpm --filter @debate-arena/web exec playwright install chromium   # once
pnpm --filter @debate-arena/web build
pnpm --filter @debate-arena/web e2e          # Playwright + axe on a phone-sized screen
pnpm --filter @debate-arena/web lighthouse   # Performance ≥ 90, SEO 100, Accessibility 100 on mobile slow 4G
```

Both web checks start their own servers from the build (`apps/web/scripts/serve.mjs`: the API on port 8799 and the web on 4321), so stop `pnpm dev` first.
