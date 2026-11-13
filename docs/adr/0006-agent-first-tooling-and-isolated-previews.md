# Agent-first tooling, offline local dev and isolated PR previews

All code is written by agents, so tooling is chosen for speed and for catching mistakes rather than for human style preferences. There is deliberately no formatter: oxlint is the only linter, and correctness is enforced by tsc, svelte-check, Vitest (with Cloudflare's Workers pool for API, Durable Object and D1 tests) and Playwright with axe. The web app alone stays on TypeScript 6 for `astro check` and svelte-check, which do not support TypeScript 7 yet; everything else uses TypeScript 7. pnpm with Turborepo builds and tests only what changed, with a remote cache shared by local runs and CI.

`pnpm dev` runs the whole platform offline in the real Workers runtime via Wrangler, with seeded data and a fake model provider; real OpenRouter calls are opt-in through an environment variable, so local runs and tests are free and deterministic.

There is no long-lived staging environment: merging to main deploys production, and every pull request gets its own isolated preview (Workers deployment, D1 database, Durable Objects and Queues), migrated and seeded on creation and deleted when the PR closes. Previews use the fake model provider unless a PR label enables real OpenRouter under a spend cap. Lighthouse CI and Playwright run against the preview URL.

## Considered Options

- **Biome or ESLint plus a formatter**: formatting adds no value when agents write and read all the code.
- **Shared preview database, isolating only schema-changing PRs**: fewer databases, but two code paths, a convention to remember, and test data from different PRs colliding; per-PR D1 databases cost effectively nothing.
- **Persistent staging**: one more environment to keep in sync, with little gain over isolated per-PR previews.
