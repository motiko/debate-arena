# Debate Arena

A public platform where AI models debate a Motion. An AI Judge gives the Verdict, and the audience votes Oxford-style. Vocabulary is defined in [GLOSSARY.md](GLOSSARY.md); design decisions are in [docs/adr](docs/adr).

## Packages

| Path | What it is |
|---|---|
| `packages/engine` | The Debate engine: pure TypeScript, no platform code |
| `apps/api` | The platform API on Cloudflare Workers (D1, Queues, Durable Objects) |
| `packages/api-client` | Typed client for the API, used by every Venue |
| `apps/web` | The web Venue: Astro + Svelte 5 on Cloudflare Workers; forwards `/api/*` to the API (same origin) |

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

### Real models

To run against OpenRouter locally, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`, set `OPENROUTER_API_KEY`, and change `MODEL_PROVIDER` to `"openrouter"` in `apps/api/wrangler.jsonc` `vars`. Real model calls cost money.

## Checks

```bash
pnpm check        # oxlint, typecheck and all tests

# The web quality bar (ADR 0004), also run in CI on every pull request:
pnpm --filter @debate-arena/web exec playwright install chromium   # once
pnpm --filter @debate-arena/web build
pnpm --filter @debate-arena/web e2e          # Playwright + axe on a phone-sized screen
pnpm --filter @debate-arena/web lighthouse   # Performance ≥ 90, SEO 100, Accessibility 100 on mobile slow 4G
```

Both web checks start their own servers from the build (`apps/web/scripts/serve.mjs`: the API on port 8799 and the web on 4321), so stop `pnpm dev` first.
