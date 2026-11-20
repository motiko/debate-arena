// Secrets are not in wrangler.jsonc, so they are typed here. Locally they come from .dev.vars; in production from
// `wrangler secret put`; in tests from vitest.config.ts miniflare bindings. `wrangler types` runs with an empty
// --env-file so it never reads .dev.vars: the generated file stays the same on every machine.
interface WorkerSecrets {
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OPENROUTER_API_KEY?: string;
  /** Signs OpenRouter's batch webhooks; without it the webhook is off and Batch Debates rely on polling. */
  OPENROUTER_WEBHOOK_SECRET?: string;
  /** Scaleway Transactional Email (EMAIL_PROVIDER "scaleway"). */
  SCALEWAY_SECRET_KEY?: string;
  SCALEWAY_PROJECT_ID?: string;
}

// The global Env (handlers, Hono bindings) and Cloudflare.Env (`env` from cloudflare:workers).
interface Env extends WorkerSecrets {}
declare namespace Cloudflare {
  interface Env extends WorkerSecrets {}
}
