# Agent-first tooling, offline local dev and isolated PR previews

All code is written by agents, so tooling is chosen for speed and for catching mistakes rather than for human style preferences. There is deliberately no formatter: oxlint is the only linter, and correctness is enforced by tsc, svelte-check, Vitest (with Cloudflare's Workers pool for API, Durable Object and D1 tests) and Playwright with axe. The web app alone stays on TypeScript 6 for `astro check` and svelte-check, which do not support TypeScript 7 yet; everything else uses TypeScript 7. pnpm with Turborepo builds and tests only what changed, with a local cache.

`pnpm dev` runs the whole platform offline in the real Workers runtime via Wrangler, with seeded data and a fake model provider; real OpenRouter calls are opt-in through an environment variable, so local runs and tests are free and deterministic.

There is no long-lived staging environment: a push to main deploys production at once, without waiting for CI. Small changes and fixes go straight to main with `pnpm ship`, which runs lint, typecheck, unit tests and Playwright with axe locally (about a minute and a half, against four minutes or more in CI) and then pushes; a pre-push hook runs the same checks for any other push to main. CI still runs the fast checks on every push to main, as a safety net that reports a failure after the deploy. Big changes, and any change with a D1 migration, go through a pull request, where CI also runs Lighthouse; Lighthouse runs weekly on main as well. Every pull request gets its own isolated preview (Workers deployment, D1 database, Durable Objects and Queues), migrated on creation and deleted when the PR closes. Previews use the fake model provider and accept the dev sign-in header, since their data is throwaway. Lighthouse CI and Playwright run in CI against a local build of the same commit rather than against the preview URL, so a pull request's quality gate does not depend on Cloudflare being reachable; the preview is for people to try the change.

Not built yet: seeded preview data, and a PR label that enables real OpenRouter under a spend cap.

## Considered Options

- **Biome or ESLint plus a formatter**: formatting adds no value when agents write and read all the code.
- **Shared preview database, isolating only schema-changing PRs**: fewer databases, but two code paths, a convention to remember, and test data from different PRs colliding; per-PR D1 databases cost effectively nothing.
- **Persistent staging**: one more environment to keep in sync, with little gain over isolated per-PR previews.
- **CI gating every deploy** (the first setup): about five and a half minutes from push to production, mostly CI repeating checks the agent had just run locally, and billed Actions minutes on a private repository. A broken push now reaches production before CI reports it; the local checks and the pre-push hook are what stop it, and big or migration-bearing changes keep the pull-request gate.
- **A Turborepo remote cache, so CI reuses local results**: needs a hosted cache account, and saves little once CI no longer holds the deploy up.
