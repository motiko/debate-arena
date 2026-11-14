import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // The real domain is set in Plan 7 (delivery).
  site: 'https://debate-arena.invalid',
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
