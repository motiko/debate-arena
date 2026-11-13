# Members and Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Members: sign in with GitHub, start Debates under their own account, cast Oxford Audience Votes (with Turns hidden until their before-vote), and export or delete their account.

**Architecture:** Better Auth runs inside the existing Worker, mounted at `/api/auth/*`, storing users and sessions in D1 through its built-in D1 support. The whole API moves under `/api` so the Astro web app (Plan 4) can share its origin and cookies need no cross-site setup. A `MemberResolver` reads the Better Auth session; the dev header stays as a local-only fallback. Votes live in a new `audience_votes` table; the engine's `computeOxfordResult` produces the Audience Result.

**Tech Stack:** Better Auth 1.7 (`better-auth`, CLI `auth`), its `testUtils` plugin for tests, Hono, D1, `@cloudflare/vitest-plugin`.

**Spec:** `GLOSSARY.md` (Member, Viewer, Audience Vote, Swing, Audience Result, Voting Method), ADR 0001 (Oxford voting), ADR 0002 (only web counts votes at first), ADR 0003, ADR 0005 (EU, account export and deletion), roadmap Plan 3 row. This plan starts with GitHub sign-in only; Google and email magic links are later additions.

## Global Constraints

- Every API route is under `/api` (`/api/health`, `/api/debates`, …); Better Auth's `basePath` is `/api/auth`, so the GitHub callback is `{BETTER_AUTH_URL}/api/auth/callback/github`.
- Secrets: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (local: `apps/api/.dev.vars`); var `BETTER_AUTH_URL` (local `http://localhost:8787`). Never logged or returned.
- `compatibility_flags: ["nodejs_compat"]` in both environments.
- Better Auth: `database: env.DB`, GitHub provider only, `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`, `rateLimit: { enabled: true, storage: "database" }`, `user.deleteUser.enabled: true`.
- A Member's id is the Better Auth user id.
- The dev header `x-dev-member` is honored only when `DEV_AUTH === "true"` and only when no session exists.
- Audience Votes (Classic Format, Oxford): one row per Member per Debate; `before` and `after` are each `for | against | undecided`, set once, never changed. A before-vote may be cast while the Debate is running or within its voting window; an after-vote only after the Debate is complete, within the window, and after a before-vote. The window is `votingMethod.windowDays` (7) after `completedAt`.
- A signed-in Member without a before-vote gets the Debate without Turns (`turnsHidden: true`); signed-out Viewers see Turns.
- The Audience Result is shown live while voting is open (simplest; revisit if it sways votes).
- Deleting an account deletes the Member's Better Auth rows and re-links their votes and Debates to a fresh random id (results unchanged, no link to the person).

## Review Focus

- **Vote replay:** casting the same before- or after-vote twice, or changing it, must return 409 and leave the first stance (Task 5).
- **Window edges:** an after-vote at exactly `completedAt + 7 days` is refused; one a second earlier is accepted; a vote on a failed Debate is refused (Task 5).
- **Production impersonation:** with `DEV_AUTH: "false"`, an `x-dev-member` header must never authenticate (Task 3).
- **Cookie/session tampering:** a forged or expired session cookie resolves to no Member (Task 3).
- **Deletion completeness:** after deletion no row anywhere holds the old user id, and the Debate's Audience Result is unchanged (Task 6).

---

## File Structure

```
apps/api/
  migrations/0002_better_auth.sql    Better Auth tables (generated) + rateLimit
  migrations/0003_audience_votes.sql audience_votes
  src/auth/auth.ts                   makeAuth(env, plugins?) / getAuth(env)
  src/auth/member.ts                 memberResolver: session, then dev header
  src/db/votes.ts                    Audience Vote repository
  src/votes/rules.ts                 voting window and vote validation
  src/account/account.ts             export and anonymisation
  test/auth-helpers.ts               test-only auth instance with testUtils, signedInHeaders()
```

---

### Task 1: Move the API under `/api` and enable `nodejs_compat`

**Files:**
- Modify: `apps/api/src/app.ts` (`new Hono<{ Bindings: Env }>().basePath('/api')`), `apps/api/wrangler.jsonc` (`compatibility_flags` in both envs), all `apps/api/test/*.test.ts` URLs, `packages/api-client/src/index.test.ts` (`client.api.debates…`), `README.md` curl examples.

**Interfaces:**
- Produces: every route path prefixed with `/api`; `AppType` reflects it (client calls become `client.api.debates.$post(...)`).

- [ ] **Step 1: Change the tests first** — every request URL gains `/api` (e.g. `https://api.test/api/health`), and the client test expects `https://api.test/api/debates/d1`.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @debate-arena/api test` → 404s; `pnpm --filter @debate-arena/api-client test` → URL mismatch.
- [ ] **Step 3: Add `.basePath('/api')` and the compatibility flag; regenerate types** (`pnpm --filter @debate-arena/api types`).
- [ ] **Step 4: Run** `pnpm check` → all pass.
- [ ] **Step 5: Commit** `refactor(api): serve the API under /api and enable nodejs_compat`

---

### Task 2: Better Auth with GitHub sign-in

**Files:**
- Create: `apps/api/migrations/0002_better_auth.sql`, `apps/api/src/auth/auth.ts`, `apps/api/test/auth-helpers.ts`
- Modify: `apps/api/src/app.ts` (mount handler, `GET /api/me`), `apps/api/wrangler.jsonc` (var `BETTER_AUTH_URL` in both envs), `apps/api/vitest.config.ts` (miniflare bindings for the three secrets with test values), `apps/api/.dev.vars.example`
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AuthEnv { DB: D1Database; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string }
export function makeAuth(env: AuthEnv, plugins?: BetterAuthPlugin[]): Auth; // betterAuth({...Global Constraints settings, plugins})
export function getAuth(env: AuthEnv): Auth; // memoised per isolate
// test/auth-helpers.ts
export function signedInHeaders(name?: string): Promise<{ userId: string; headers: Headers }>; // testUtils: createUser, saveUser, getAuthHeaders
```

Migration: generate with `npx auth@latest generate` against a config using the settings above (point `database` at `new DatabaseSync(':memory:')` from `node:sqlite` only for generation), output to `0002_better_auth.sql`, and commit it. It must contain `user`, `session`, `account`, `verification` and `rateLimit`. `GET /api/me` returns 401 `{ error: 'Not signed in' }` or 200 `{ id, name, image, quotaRemaining }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('GET /api/me without a session is 401', async () => {});
test('GET /api/me with a session returns the Member and their Quota', async () => {
  const { userId, headers } = await signedInHeaders('Ada');
  const res = await exports.default.fetch('https://api.test/api/me', { headers });
  expect(await res.json()).toEqual({ id: userId, name: 'Ada', image: null, quotaRemaining: 6 });
});
test('the GitHub sign-in route redirects to GitHub', async () => {
  const res = await exports.default.fetch('https://api.test/api/auth/sign-in/social', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
    body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { url: string }).url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: Generate the migration, implement**, **Step 4: Run to verify pass** — `pnpm --filter @debate-arena/api test -- auth`
- [ ] **Step 5: Commit** `feat(api): Better Auth with GitHub sign-in on D1`

---

### Task 3: Members from sessions

**Files:**
- Modify: `apps/api/src/auth/member.ts`, `apps/api/src/app.ts` (`POST /api/debates` and `GET /api/me` use it)
- Test: `apps/api/test/member.test.ts`

**Interfaces:**
- Produces: `memberResolver(env: AuthEnv & { DEV_AUTH: string }): MemberResolver` — the Better Auth session's user id; else, when `DEV_AUTH === 'true'`, the trimmed `x-dev-member` header; else `null`. (`devMemberResolver` is removed.)

- [ ] **Step 1: Write the failing tests**

```ts
test('a session starts a Debate as that Member', async () => { /* signedInHeaders → POST /api/debates 201; stored memberId === userId */ });
test('with DEV_AUTH "false" the dev header is ignored', async () => {
  const resolve = memberResolver({ ...env, DEV_AUTH: 'false' });
  expect(await resolve(new Request('https://x', { headers: { 'x-dev-member': 'evil' } }))).toBeNull();
});
test('a forged session cookie resolves to no Member', async () => { /* cookie better-auth.session_token=forged.value → null */ });
test('a session wins over the dev header', async () => { /* both present → session user id */ });
```

- [ ] **Steps 2–4:** run → fail; implement; run → pass (`pnpm --filter @debate-arena/api test -- member routes`)
- [ ] **Step 5: Commit** `feat(api): resolve Members from Better Auth sessions`

---

### Task 4: Audience Vote repository

**Files:**
- Create: `apps/api/migrations/0003_audience_votes.sql`, `apps/api/src/db/votes.ts`
- Test: `apps/api/test/db-votes.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AudienceVote { debateId: string; memberId: string; before: Stance | null; after: Stance | null }
export function castBefore(db: D1Database, debateId: string, memberId: string, stance: Stance, at: string): Promise<boolean>; // false if a before-vote exists
export function castAfter(db: D1Database, debateId: string, memberId: string, stance: Stance, at: string): Promise<boolean>; // false unless a before-vote exists and no after-vote
export function getVote(db: D1Database, debateId: string, memberId: string): Promise<AudienceVote | null>;
export function listVotes(db: D1Database, debateId: string): Promise<AudienceVote[]>;
```

Table `audience_votes` (debate_id, member_id, before_stance, before_at, after_stance, after_at, PRIMARY KEY (debate_id, member_id)), stance columns `CHECK (... IN ('for','against','undecided'))`. `castBefore` is `INSERT ... ON CONFLICT DO NOTHING`; `castAfter` is `UPDATE ... WHERE before_stance IS NOT NULL AND after_stance IS NULL`.

- [ ] **Step 1: Write the failing tests** — before then after round-trips; second before returns false and keeps the first; after without before returns false; second after returns false; `listVotes` returns all Members' votes for one Debate only.
- [ ] **Steps 2–4:** fail; implement; pass (`pnpm --filter @debate-arena/api test -- db-votes`)
- [ ] **Step 5: Commit** `feat(api): Audience Vote storage`

---

### Task 5: Voting rules, routes and the Audience Result

**Files:**
- Create: `apps/api/src/votes/rules.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/votes.test.ts`

**Interfaces:**
- Produces:

```ts
export function votingClosesAt(debate: DebateRecord): string | null; // completedAt + windowDays, or null while running/failed
export type VoteCheck = { ok: true } | { ok: false; status: 403 | 409; error: string };
export function checkVote(debate: DebateRecord, existing: AudienceVote | null, phase: 'before' | 'after', now: Date): VoteCheck;
```

`checkVote` rules: failed Debate → 403 `"Voting is closed for this Debate"`; window passed (`now >= votingClosesAt`) → 403 same message; before-vote already cast → 409 `"You already voted before this Debate"`; after-vote: Debate not complete → 403 `"Vote again when the Debate is complete"`, no before-vote → 403 `"Vote before reading the Debate first"`, already cast → 409 `"You already voted after this Debate"`.

Route `POST /api/debates/:id/votes` body `{ phase: 'before' | 'after', stance: 'for' | 'against' | 'undecided' }` → 401 / 400 / 404 / 403 / 409 / 201 `{ vote }`. A 409 is also returned if the repository write returns false (race). `GET /api/debates/:id` adds `audienceResult: computeOxfordResult(votes) & { votingClosesAt }`, `myVote` (signed in only), and for a signed-in Member without a before-vote returns `turns: []` with `turnsHidden: true`.

- [ ] **Step 1: Write the failing tests**

```ts
test('before, then after when complete, updates the Audience Result', async () => { /* 2 Members: undecided→for, against→for → counted 2, winner 'for' */ });
test('Turns are hidden from a signed-in Member until their before-vote', async () => { /* turnsHidden true, turns [] → after vote: 6 Turns */ });
test('signed-out Viewers still see Turns', async () => {});
test.each(['before', 'after'])('a second %s-vote is 409 and keeps the first stance', async () => {});
test('an after-vote while running is 403; without a before-vote is 403', async () => {});
test('the window closes exactly 7 days after completion', async () => { /* checkVote at completedAt+7d-1s ok; at +7d 403 */ });
test('votes on a failed Debate are refused', async () => {});
test('invalid phase or stance is 400; unknown Debate is 404; signed out is 401', async () => {});
```

- [ ] **Steps 2–4:** fail; implement; pass (`pnpm --filter @debate-arena/api test -- votes`)
- [ ] **Step 5: Commit** `feat(api): Oxford Audience Votes with Turn gating`

---

### Task 6: Account export and deletion

**Files:**
- Create: `apps/api/src/account/account.ts`
- Modify: `apps/api/src/auth/auth.ts` (`user.deleteUser.beforeDelete` calls `anonymiseMember`), `apps/api/src/app.ts` (`GET /api/me/export`)
- Test: `apps/api/test/account.test.ts`

**Interfaces:**
- Produces:

```ts
export function exportMember(db: D1Database, memberId: string): Promise<{ member: { id: string; name: string; email: string; createdAt: string }; debates: PublicDebate[]; votes: AudienceVote[] }>;
export function anonymiseMember(db: D1Database, memberId: string): Promise<void>; // one D1 batch: debates.member_id and audience_votes.member_id → `deleted-${crypto.randomUUID()}`
```

Deletion goes through Better Auth's `POST /api/auth/delete-user` (fresh session required; `freshAge` default 1 day). Because D1 has no transactions, `anonymiseMember` runs as a single `db.batch` in `beforeDelete`; if it throws, the delete aborts.

- [ ] **Step 1: Write the failing tests**

```ts
test('export returns the Member, their Debates and votes', async () => {});
test('export without a session is 401', async () => {});
test('deleting an account removes the user and unlinks their data', async () => {
  // signed in, start a Debate, vote; POST /api/auth/delete-user with session headers
  // → user, session, account rows gone; no debates/audience_votes row with member_id = userId;
  //   the Debate still exists and its audienceResult.counted is unchanged
});
```

- [ ] **Steps 2–4:** fail; implement; pass (`pnpm --filter @debate-arena/api test -- account`)
- [ ] **Step 5: Commit** `feat(api): account export and deletion`

---

### Task 7: Local GitHub sign-in and docs

**Files:**
- Modify: `README.md`, `apps/api/.dev.vars.example`

- [ ] **Step 1:** `pnpm check` → all pass.
- [ ] **Step 2: README** — how to create a GitHub OAuth App (homepage `http://localhost:8787`, callback `http://localhost:8787/api/auth/callback/github`), fill `.dev.vars` (`BETTER_AUTH_SECRET` from `openssl rand -base64 32`), and that `x-dev-member` still works locally without it.
- [ ] **Step 3: Manual check (needs the human's OAuth App):** `pnpm dev`, open `http://localhost:8787/api/auth/sign-in/social` flow via a POST from a browser console or a tiny HTML page; after GitHub consent, `GET /api/me` returns the Member. Record the outcome; if the OAuth App isn't available, record that the live check is pending.
- [ ] **Step 4: Commit** `docs: GitHub sign-in for local development`
