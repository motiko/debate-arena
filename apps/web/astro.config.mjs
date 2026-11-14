import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import { defineConfig, fontProviders } from 'astro/config';
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
  // One self-hosted reading serif, preloaded with a metric-matched fallback; no third-party requests (ADR 0005, 0007).
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Source Serif 4',
      cssVariable: '--font-serif',
      fallbacks: ['Georgia', 'serif'],
      options: { variants: [{ src: ['./src/assets/fonts/source-serif-4-latin-wght-normal.woff2'], weight: '200 900', style: 'normal' }] },
    },
  ],
});
