/// <reference types="astro/client" />

// The web Worker's own bindings. The API's worker-configuration.d.ts (included by tsconfig, because the
// api-client's route types refer to it) already declares the Workers runtime and the API's Env, so
// `wrangler types` is not run here: a second runtime declaration would collide. These merge into that Env;
// the web Worker only ever reads API and ASSETS.
interface Env {
  API: Fetcher;
  ASSETS: Fetcher;
}
declare namespace App {
  interface Locals {
    api: import('@debate-arena/api-client').ApiClient;
    me: import('./lib/server-api').Me | null;
  }
}
declare namespace Cloudflare {
  interface Env {
    API: Fetcher;
    ASSETS: Fetcher;
  }
}
