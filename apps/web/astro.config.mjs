import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';
import { readApiConfig, siteUrl } from './site.mjs';

export default defineConfig({
  // Canonical links: the production address in a production build (from the API's BETTER_AUTH_URL), else localhost.
  site: siteUrl(process.env.CLOUDFLARE_ENV, readApiConfig()),
  // No Astro sessions: Members' sessions belong to the API (Better Auth), so no KV binding is needed.
  session: false,
  // Pages are rendered per request: they show live Debate state and the signed-in Member.
  output: 'server',
  integrations: [svelte()],
  adapter: cloudflare({ imageService: 'compile' }),
  // One small stylesheet, inlined: no render-blocking request on slow connections (ADR 0004).
  build: { inlineStylesheets: 'always' },
  server: { port: 4321 },
});
