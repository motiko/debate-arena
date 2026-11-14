# Delivery and Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform can go live, compliantly:
- Merging to main deploys production on Cloudflare: EU-jurisdiction D1, then the API Worker, then the web Worker, all on `workers.dev` for now.
- Every pull request gets its own isolated preview, deleted on close.
- The site has an Impressum, a privacy policy and terms of use.
- Page views are counted without cookies or client scripts.
- DSA notices go out by email:
  - Report receipts;
  - decisions to reporters who left an address;
  - statements of reasons to the authors of Blocked Debates.
- OpenRouter's batch webhook makes Batch Debates move on as soon as results are in.

**Architecture:**
- **Production config:** a release check (`scripts/check-release.mjs`) refuses to deploy production while any `REPLACE_ME` placeholder remains in production config or legal pages. Placeholders include operator details, the D1 id and the production URL.
- **Deploys:** GitHub Actions runs `wrangler` with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets, in order: migrations, API, web (the web build is chosen with `CLOUDFLARE_ENV`, per the Astro adapter).
- **Previews:** a script generates each PR's Wrangler configs (named Workers, their own EU D1 and queues). Previews run fake models with `DEV_AUTH` on, against throwaway data.
- **Email:** sent through an `EmailSender` port. Scaleway Transactional Email (EU-resident) is used when configured; otherwise a no-op that logs.

**Tech Stack:**
- Wrangler 4.162 and the Astro Cloudflare adapter 14.
- GitHub Actions (`actions/checkout@v6`).
- Cloudflare D1 (`--jurisdiction=eu`), Queues and Workers Analytics Engine.
- Scaleway TEM REST API.
- OpenRouter batch webhooks (`X-OpenRouter-Signature: t=…,v1=<hex HMAC-SHA256 of "t,rawBody">`).

**Spec:**
- ADR 0003 (Workers, D1 EU), ADR 0005 (EU-first, no banner, Impressum and privacy, cookieless analytics), ADR 0006 (no staging; per-PR isolated previews).
- Roadmap row 7.
- Plan 5 deferrals: email notices, terms page.
- Plan 6 deferral: batch webhook.
- User decisions (2026-11-14): Cloudflare account with repo secrets; `workers.dev` for now; email provider chosen after research; operator details as placeholders until launch.

## Global Constraints

- **Placeholders** are the literal `REPLACE_ME…` (e.g. `REPLACE_ME_OPERATOR_NAME`). `scripts/check-release.mjs` fails, listing file and line, if any appear in:
  - `apps/api/wrangler.jsonc` `env.production`;
  - `apps/web/wrangler.jsonc` `env.production`;
  - `apps/web/src/legal/operator.ts`.

  The production deploy job runs it first.
- **Production names:**
  - API Worker `debate-arena-api-production` (Wrangler's env suffix);
  - web Worker `debate-arena-web` (Astro builds a flattened config with the top-level name);
  - D1 `debate-arena` (EU jurisdiction, id `REPLACE_ME_D1_ID` until created);
  - queues `debate-steps-production` and `debate-steps-production-dlq`;
  - Analytics Engine dataset `debate_arena_pageviews`.

  Production `BETTER_AUTH_URL` is `REPLACE_ME_PRODUCTION_URL` (`https://debate-arena-web.<subdomain>.workers.dev`).
- **Deploy order:** migrations (`--remote --env production`), then the API (`wrangler deploy --env production`), then the web build (`CLOUDFLARE_ENV=production`), then the web deploy (no `--env`).
- **Previews per PR `n`:**
  - Workers `debate-arena-api-pr-n` and `debate-arena-web-pr-n`.
  - D1 `debate-arena-pr-n` (`--jurisdiction=eu`).
  - Queues `debate-steps-pr-n` and `debate-steps-pr-n-dlq`.
  - Vars: `MODEL_PROVIDER: "fake"`, `DEV_AUTH: "true"`, `BETTER_AUTH_URL` set to the preview web URL.
  - Created or updated on `opened` / `synchronize` / `reopened`, deleted on `closed`. The PR gets a comment with the URL.
  - Only for PRs from this repository, not forks, since secrets aren't exposed to forks.
- **Analytics (server-side only):** one Analytics Engine data point per HTML page view, written by the web Worker. It holds the path template, country, referrer host and a bot flag. No IP, user agent, cookie or id, and no client script. If the binding is missing (local dev), nothing is written.
- **Email:**
  - `EMAIL_PROVIDER: "none" | "scaleway"`. With `"scaleway"`, the secrets `SCALEWAY_SECRET_KEY` and `SCALEWAY_PROJECT_ID` and the var `EMAIL_FROM` are needed.
  - Sending is best-effort: it never fails a request or a decision. A failed send is logged.
  - **Report receipt:** sent to the reporter's email (anonymous reporters who gave one).
  - **Decision:** on relist or Block, to every reporter since the last review who gave an email.
  - **Statement of reasons:** on Block, to the starting Member's account email, if the account still exists. It holds the ground, reference, explanation, date, the fact that a person decided, and how to contest it (reply to the operator's contact email).
  - Plain text only, always in English (copy in `apps/api/src/notices/messages.ts`).
- **Legal pages:** `/impressum`, `/privacy` and `/terms`, linked from every page footer.
  - All copy is in `src/i18n/en.ts` or `src/legal/*`; operator details come from `src/legal/operator.ts`.
  - The privacy policy follows the research outline: controller; hosting (Cloudflare, EU D1); GitHub login; session cookie (strictly necessary); AI processing via OpenRouter and model providers, some in the US; public Debate content; Reports and moderation; cookieless analytics; email processor (Scaleway); retention; rights; no solely automated decisions (the AI screen only Flags, people decide).
  - Pages are noindex: no; Lighthouse/SEO apply as on other pages.
- **Batch webhook:** `POST /api/webhooks/openrouter`.
  - It verifies `X-OpenRouter-Signature` against `OPENROUTER_WEBHOOK_SECRET`, rejects timestamps more than 300 s off, and compares in constant time. A missing secret means 404 (disabled).
  - For `batch.completed`, `batch.failed`, `batch.expired` and `batch.cancelled`, it finds the Debate by `batch_calls.batch_id` and enqueues `{ debateId }` (no delay).
  - Polling stays as the fallback.
- **ADR 0006 deviation:** Lighthouse and Playwright keep running in CI against the local build of the same code, not against the preview URL. The PR's quality gate then doesn't depend on Cloudflare availability. Record this in ADR 0006's Consequences.
- **Tooling and attribution:** as before. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A webhook from anyone:** a forged or replayed call must do nothing (401) and must not reveal whether a batch id exists. A valid one for an unknown batch is 200 and does nothing. Owner: Task 4.
2. **Email failure mid-decision:** a Moderator's Block must succeed and record its statement even when Scaleway is down or returns an error. Owner: Task 3 `a failing email never fails the decision`.
3. **Contact details:** only the reporter's own email receives their receipt and decision. A deleted author gets no email (no account email exists). Owner: Task 3.
4. **Placeholders slipping into production:** the release check runs before any production command, and a placeholder anywhere it scans fails the job with file:line. Owner: Task 1.
5. **Preview teardown:** closing a PR deletes both Workers, then the queues, then the D1. Running teardown twice, or for a PR whose preview never existed, succeeds. Owner: Task 5 (script tested; the workflow runs `|| true` only on "not found" errors, via the script's own idempotent handling).

---

### Task 1: Production configuration and release check

**Files:**
- Modify: `apps/api/wrangler.jsonc` (`env.production`: D1 id placeholder, prod queue names, `BETTER_AUTH_URL` placeholder, `EMAIL_PROVIDER`, `EMAIL_FROM`), `apps/web/wrangler.jsonc` (`env.production` service `debate-arena-api-production`, analytics binding)
- Create: `scripts/check-release.mjs`, `scripts/check-release.test.mjs` (`node --test`)
- Modify: root `package.json` (`"check:release": "node scripts/check-release.mjs"`, and `test:scripts` added to `pnpm check`)

**Interfaces:**
- Produces:
  - `findPlaceholders(files: { path: string; text: string; section?: 'env.production' }[]): { path: string; line: number; token: string }[]`.
    - For the Wrangler files, only the `env.production` block is scanned (from the `"production"` key to its closing brace, matched by brace depth).
  - The CLI runs over the fixed file list and exits 1 with one line per finding.

- [ ] **Step 1: Write the failing tests:**
  - `finds placeholders with file and line`;
  - `ignores placeholders outside env.production`;
  - `passes a clean config`.
- [ ] **Step 2: Run** `node --test scripts/`. Expected: FAIL.
- [ ] **Step 3: Implement** the script and the production config (placeholders in place).
- [ ] **Step 4: Run** `node --test scripts/` and `pnpm check`. Expected: PASS. Then run `node scripts/check-release.mjs`. Expected: exit 1, listing the current placeholders.
- [ ] **Step 5: Commit** `feat: production configuration with a release check for placeholders`.

### Task 2: Legal pages and cookieless page views

**Files:**
- Create:
  - `apps/web/src/legal/operator.ts`: `OPERATOR = { name, street, postcode, city, country, email, phone }`, all placeholders, plus `responsibleForContent`.
  - `apps/web/src/pages/{impressum,privacy,terms}.astro`
  - `apps/web/src/lib/analytics.ts`
- Modify: `apps/web/src/layouts/Base.astro` (footer links), `apps/web/src/route.ts` and `apps/web/src/worker.ts` (record page views), `apps/web/src/env.d.ts` (`ANALYTICS?: AnalyticsEngineDataset`), `apps/web/src/i18n/en.ts`
- Test: `apps/web/test/analytics.test.ts`, `apps/web/e2e/legal.spec.ts`

**Interfaces:**
- Produces:
  - `pageViewPoint(request: Request, response: Response): AnalyticsEngineDataPoint | null`.
    - It returns null for non-GET requests, `/api/*`, non-HTML responses and status ≥ 400.
    - Otherwise `blobs`: `[pathTemplate, country, referrerHost, isBot ? 'bot' : 'human']`, `indexes`: `[pathTemplate]`, and `doubles`: `[1]`.
    - `pathTemplate` replaces ids: `/debates/<id>` becomes `/debates/:id`, `/blocked/<id>` becomes `/blocked/:id`.
    - `country` comes from `request.cf?.country` or `'??'`.
    - `isBot` comes from `request.cf?.botManagement?.verifiedBot`, or a user-agent `/bot|crawl|spider|lighthouse/i` check; the user agent itself is not stored.
  - `routeRequest` gains an optional `analytics` and writes the point after the Astro response, with `ctx.waitUntil` not needed (the write is synchronous).

- [ ] **Step 1: Write the failing tests:**
  - **Unit:**
    - `counts an HTML page view with a path template`;
    - `does not count API calls, assets or errors`;
    - `stores no IP or user agent`.
  - **e2e:**
    - `the footer links to Impressum, privacy policy and terms`;
    - `legal pages show the operator`;
    - axe on all three pages.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, build, e2e and lighthouse. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Impressum, privacy policy and terms; cookieless page views`.

### Task 3: Email notices (DSA)

**Files:**
- Create: `apps/api/src/notices/{email.ts,messages.ts,notify.ts}`
- Modify: `apps/api/src/app.ts` (the Report and decision routes), `apps/api/wrangler.jsonc` (vars), `apps/api/src/secrets.d.ts`, `apps/api/.dev.vars.example`
- Test: `apps/api/test/notices.test.ts`

**Interfaces:**
- Produces:
  - **`interface EmailSender { send(message: { to: string; subject: string; text: string }): Promise<void> }`.**
    - `ScalewayEmailSender(secretKey, projectId, from, fetch?)` POSTs `https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails` with header `X-Auth-Token` and body `{ from: { email: from }, to: [{ email: to }], subject, text, project_id }`. A non-2xx response throws.
    - `NoEmailSender` logs the subject only.
    - `createEmailSender(env)` picks by `EMAIL_PROVIDER`.
  - **`messages.ts`:** `reportReceipt(debateUrl)`, `reportDecision(debateUrl, action)` and `statementOfReasons({ debateUrl, motion, ground, groundRef, explanation, decidedAt, contact })`, each returning `{ subject, text }`. `debateUrl` is built from `BETTER_AUTH_URL`.
  - **`notify.ts`:**
    - `noticeReportReceived(env, report)`;
    - `noticeDecision(env, debate, decision)` (reporters since the last review with an email, plus the author's statement on Block);
    - all go through `sendBestEffort`, which catches and logs.
  - **Routes:** the Report route sends the receipt (via `executionCtx.waitUntil`) when an email was given. The decision route sends decision notices after `recordDecision` succeeds.
  - The author's email is read from `"user"` by `debates.member_id`. A deleted author has an anonymised member id, so no user row and no email.

- [ ] **Step 1: Write the failing tests:**
  - `Scaleway sender posts the documented request`;
  - `a Report with an email gets a receipt`;
  - `a Block sends the statement of reasons to the author`;
  - `a decision notifies reporters who left an email, and only them`;
  - `a failing email never fails the decision`;
  - `a deleted author gets no email`;
  - `with EMAIL_PROVIDER none nothing is sent`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): DSA email notices for Reports and decisions`.

### Task 4: OpenRouter batch webhook

**Files:**
- Create: `apps/api/src/webhooks/openrouter.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/secrets.d.ts` (`OPENROUTER_WEBHOOK_SECRET?`), `apps/api/src/models/batch.ts` (`callback_url` when configured)
- Test: `apps/api/test/webhook.test.ts`

**Interfaces:**
- Produces:
  - **`verifySignature(secret, header, rawBody, nowSeconds): Promise<boolean>`** parses `t=…,v1=…`, accepts `|now - t| ≤ 300`, computes HMAC-SHA256 of `${t}.${rawBody}`, and compares in constant time.
    - The brief says `"t,rawBody"`. Verify the exact joiner in OpenRouter's docs during this task and rule on it in the ledger.
  - **`POST /api/webhooks/openrouter`:**
    - 404 when no secret is configured.
    - 401 on a bad signature or timestamp.
    - 200 otherwise. For a completed or ended batch with a known `batch_calls.batch_id`, it enqueues `{ debateId }` for that Debate.
  - **`OpenRouterBatchApi`** gains an optional `callbackUrl` (set from `BETTER_AUTH_URL + '/api/webhooks/openrouter'` in production when the secret exists), sent as `callback_url` before `requests`.

- [ ] **Step 1: Write the failing tests:**
  - `a valid signature enqueues the Debate's step`;
  - `a forged or stale signature is refused`;
  - `an unknown batch is accepted and ignored`;
  - `without a secret the webhook is off`;
  - `batches carry the callback URL when configured`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): OpenRouter batch webhook moves Batch Debates on at once`.

### Task 5: Deploy and preview workflows

**Files:**
- Create:
  - `.github/workflows/deploy.yml` (push to main, after CI's jobs pass: `workflow_run` on CI success for main)
  - `.github/workflows/preview.yml` (`pull_request` opened/synchronize/reopened/closed; same-repo only)
  - `scripts/preview.mjs` (`up <n>` / `down <n>`)
  - `scripts/preview.test.mjs`
  - `DEPLOY.md` (runbook)
- Modify: `README.md` (link DEPLOY.md), `docs/adr/0006-*.md` (the deviation), roadmap

**Interfaces:**
- Produces, in `scripts/preview.mjs`:
  - **`previewNames(n)`** gives `{ api, web, db, queue, dlq }`.
  - **`apiPreviewConfig(base, n, dbId, webUrl)`** takes the parsed `apps/api/wrangler.jsonc`. It returns a flat config:
    - name `debate-arena-api-pr-n`, PR D1 id and name, PR queues;
    - vars `MODEL_PROVIDER fake`, `DEV_AUTH true`, `BETTER_AUTH_URL` set to `webUrl`, `EMAIL_PROVIDER none`;
    - no `env` key;
    - the same DO export and migrations dir.
  - **`webPreviewConfig(builtConfig, n)`** patches the built `dist/server/wrangler.json`: name `debate-arena-web-pr-n`, `services[0].service` set to the PR API.
  - **`up n`:**
    1. Creates the D1 if missing (`wrangler d1 list --json`) and the queues if missing.
    2. Writes the configs to `.preview/`.
    3. Applies migrations, then deploys the API and builds and deploys the web.
    4. Prints the web URL.
  - **`down n`:** deletes the web Worker, the API Worker, the queues and the D1. "Not found" is treated as done.
  - **`deploy.yml`:**
    1. `node scripts/check-release.mjs`
    2. migrations
    3. API deploy
    4. web build (`CLOUDFLARE_ENV=production`) and deploy
  - **`preview.yml`:**
    - `up` posts or updates a PR comment with the URL (`gh pr comment --edit-last` or a marker).
    - `closed` runs `down`.
    - Both are guarded by `if: github.event.pull_request.head.repo.full_name == github.repository`.
  - **`DEPLOY.md`** covers:
    - the token permissions: Account Workers Scripts Edit, D1 Edit, Queues Edit, Analytics Engine/Account Analytics Read; Zone Workers Routes Edit only with a custom domain;
    - the repo secrets;
    - one-time provisioning (`wrangler d1 create debate-arena --jurisdiction=eu`, `wrangler queues create …`);
    - `wrangler secret put … --env production` for each secret;
    - the production GitHub OAuth App (callback `<url>/api/auth/callback/github`);
    - filling the `REPLACE_ME` values;
    - Scaleway setup (domain verification) and the OpenRouter webhook secret;
    - `MODERATOR_GITHUB_IDS`.

- [ ] **Step 1: Write the failing tests** (`node --test scripts/`):
  - `preview names follow the PR number`;
  - `the API preview config has its own D1, queues and fake models`;
  - `the web preview config points at the PR API`;
  - `down treats not-found as done`, with an injected command runner.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the scripts, workflows and docs. Workflows use `actions/checkout@v6`, `pnpm/action-setup@v4` and `actions/setup-node@v5`, and validate as YAML (`node -e` with the yaml package, or `gh workflow view` after push).
- [ ] **Step 4: Run** `node --test scripts/` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `ci: production deploy on main and isolated per-PR previews`.
