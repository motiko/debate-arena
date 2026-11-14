# Deploying Debate Arena

Production runs on Cloudflare: the API Worker (`debate-arena-api-production`, with D1 in the EU jurisdiction, Queues
and a Durable Object) and the web Worker (`debate-arena-web`), on `workers.dev` for now. Merging to `main` deploys
production once CI has passed; every pull request can get its own isolated preview. Both are off until you switch
them on (steps 6 and 7).

Everything below is done once, by hand. Commands run from the repository root unless a directory is given.

## 1. Cloudflare API token and account id

In the Cloudflare dashboard, **My Profile → API Tokens → Create Token → Custom token**, with these permissions:

| Scope | Permission |
|---|---|
| Account | Workers Scripts — Edit |
| Account | D1 — Edit |
| Account | Queues — Edit |
| Account | Account Analytics — Read |
| Zone | Workers Routes — Edit (only when you move to your own domain) |

In GitHub, **Settings → Secrets and variables → Actions**:

- Secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (Workers overview page, right column).
- Variable: `WORKERS_SUBDOMAIN`, your `<subdomain>.workers.dev` subdomain (Workers overview page).

## 2. Create the production resources

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
cd apps/api
pnpm exec wrangler d1 create debate-arena --jurisdiction=eu   # the jurisdiction can never be changed later
pnpm exec wrangler queues create debate-steps-production
pnpm exec wrangler queues create debate-steps-production-dlq
```

Put the printed `database_id` into `apps/api/wrangler.jsonc` → `env.production` → `d1_databases` (replacing
`REPLACE_ME_D1_ID`). Workers Analytics Engine needs no setup: the `debate_arena_pageviews` dataset is created on the
first page view.

## 3. Fill in the placeholders

`node scripts/check-release.mjs` lists every `REPLACE_ME_…` left; production deploys refuse to run until it passes.

- `apps/api/wrangler.jsonc` → `env.production.vars.BETTER_AUTH_URL`: `https://debate-arena-web.<subdomain>.workers.dev`
- `apps/web/src/legal/operator.ts`: the operator's name, postal address (no P.O. box) and email, for the Impressum and
  the privacy policy. Have the privacy policy and terms (`apps/web/src/legal/content.ts`) reviewed before launch.
- Optionally `MODERATOR_GITHUB_IDS`: your numeric GitHub id (`curl -s https://api.github.com/users/<login>`, field `id`).

## 4. Production sign-in (GitHub OAuth App)

Create a second GitHub OAuth App for production: homepage `https://debate-arena-web.<subdomain>.workers.dev`, callback
`https://debate-arena-web.<subdomain>.workers.dev/api/auth/callback/github`.

## 5. Production secrets

```bash
cd apps/api
openssl rand -base64 32 | pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production
pnpm exec wrangler secret put GITHUB_CLIENT_ID --env production
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env production
pnpm exec wrangler secret put OPENROUTER_API_KEY --env production
```

Secrets can only be set on a Worker that exists. If `secret put` says the Worker does not exist, run the first deploy
(step 6) once — the API will refuse requests until its secrets are set — then set them.

Optional:

- **Email notices** (Report receipts and decisions; statements of reasons to authors of Blocked Debates): create a
  Scaleway account, verify your sending domain in Transactional Email (it adds SPF, DKIM and DMARC records), then set
  `EMAIL_PROVIDER` to `"scaleway"` and `EMAIL_FROM` to your sender address in `env.production.vars`, and
  `wrangler secret put SCALEWAY_SECRET_KEY --env production` and `SCALEWAY_PROJECT_ID`. Without them, notices are
  only shown in the app (Blocked page, data export).
- **OpenRouter batch webhook** (Batch Debates move on as soon as results are in, instead of at the next poll): in
  OpenRouter's workspace settings, **Generate signing secret**, then `wrangler secret put OPENROUTER_WEBHOOK_SECRET
  --env production`.

## 6. Switch on production deploys

Set the repository variable `DEPLOY_PRODUCTION` to `true`. From then on, every merge to `main` that passes CI runs
`.github/workflows/deploy.yml`: the release check, D1 migrations, the API, then the web. You can also run it by hand
(**Actions → Deploy production → Run workflow**).

## 7. Switch on PR previews

Set the repository variable `PREVIEWS` to `true`. Each pull request from a branch of this repository then gets its own
API and web Workers, EU D1 database and queues (`debate-arena-*-pr-<n>`), with fake models and dev sign-in, and a
comment with its URL. Everything is deleted when the PR closes (`node scripts/preview.mjs down <n>` does the same by
hand). The Free plan allows 10 D1 databases, so keep few PRs open at once there.

Previews accept the `x-dev-member` header as sign-in on purpose: their data is throwaway and their models are fake.
