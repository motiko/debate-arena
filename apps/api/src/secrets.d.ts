// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them. Locally they come from .dev.vars;
// in production from `wrangler secret put`; in tests from vitest.config.ts miniflare bindings.
interface WorkerSecrets {
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OPENROUTER_API_KEY?: string;
}

// The global Env (handlers, Hono bindings) and Cloudflare.Env (`env` from cloudflare:workers).
interface Env extends WorkerSecrets {}
declare namespace Cloudflare {
  interface Env extends WorkerSecrets {}
}
