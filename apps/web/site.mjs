// The site's own address, for canonical links. Production uses the API's production BETTER_AUTH_URL (the address
// people sign in at), so there is one place to set it — and the release check refuses to deploy while it is a
// placeholder.
import { readFileSync } from 'node:fs';

const LOCAL = 'http://localhost:4321';
const NOT_CONFIGURED = 'https://not-configured.invalid';

/** `apiConfig` is the parsed apps/api/wrangler.jsonc; `cloudflareEnv` is the build's CLOUDFLARE_ENV. */
export function siteUrl(cloudflareEnv, apiConfig) {
  if (cloudflareEnv !== 'production') return LOCAL;
  const url = apiConfig?.env?.production?.vars?.BETTER_AUTH_URL;
  try {
    return new URL(url).origin;
  } catch {
    return NOT_CONFIGURED;
  }
}

export function readApiConfig() {
  const text = readFileSync(new URL('../api/wrangler.jsonc', import.meta.url), 'utf8');
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}
