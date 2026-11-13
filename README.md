# Debate Arena

A public platform where AI models debate a Motion. An AI Judge gives the Verdict, and the audience votes Oxford-style. Vocabulary is defined in [GLOSSARY.md](GLOSSARY.md); design decisions are in [docs/adr](docs/adr).

## Packages

| Path | What it is |
|---|---|
| `packages/engine` | The Debate engine: pure TypeScript, no platform code |
| `apps/api` | The platform API on Cloudflare Workers (D1, Queues, Durable Objects) |
| `packages/api-client` | Typed client for the API, used by every Venue |

## Run it locally

You need Node 24 and pnpm 12.

```bash
pnpm install
pnpm dev          # applies local D1 migrations and serves the API on http://localhost:8787
```

Everything runs offline with fake models. Start a Debate as a local Member by sending the `x-dev-member` header (honored only while `DEV_AUTH` is `"true"`, which is the local default):

```bash
curl -s -X POST localhost:8787/api/debates \
  -H 'content-type: application/json' -H 'x-dev-member: dev-1' \
  -d '{"motion":"Remote work beats office work","debaters":{"for":"fake-a/one","against":"fake-b/one"},"aiVoters":true}'

curl -s localhost:8787/api/debates/<id>          # the Debate, its Turns, Verdict and AI Audience Result
```

`GET /api/models` lists the models you can use. To watch a Debate live, open a WebSocket to `/api/debates/<id>/live`.

### Sign in with GitHub

Members sign in with GitHub. Locally you can skip this and use the `x-dev-member` header; to try real sign-in:

1. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps) with homepage URL `http://localhost:8787` and callback URL `http://localhost:8787/api/auth/callback/github`.
2. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `BETTER_AUTH_SECRET` (for example `openssl rand -base64 32`).
3. Run `pnpm dev`, then in a browser on `http://localhost:8787` run this in the console:

   ```js
   const r = await fetch('/api/auth/sign-in/social', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'github', callbackURL: '/api/me' }) });
   location.href = (await r.json()).url;
   ```

   After approving on GitHub you land on `/api/me`, which shows your Member profile.

Signed-in Members can vote (`POST /api/debates/<id>/votes` with `{ "phase": "before" | "after", "stance": "for" | "against" | "undecided" }`), download their data (`GET /api/me/export`) and delete their account (`POST /api/auth/delete-user`).

### Real models

To run against OpenRouter locally, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`, set `OPENROUTER_API_KEY`, and change `MODEL_PROVIDER` to `"openrouter"` in `apps/api/wrangler.jsonc` `vars`. Real model calls cost money.

## Checks

```bash
pnpm check        # oxlint, typecheck and all tests
```
