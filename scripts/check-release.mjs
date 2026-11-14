// Release check: production must not ship with REPLACE_ME placeholders (operator details for the Impressum, the
// EU D1 database id, the production URL…). Run before every production deploy; exits 1 and lists each one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A placeholder always names what goes there (REPLACE_ME_D1_ID…); the bare word in comments is not one.
const PLACEHOLDER = /REPLACE_ME_[A-Z0-9_]+/g;

/** The line range of `"production": { … }` inside a Wrangler config, found by brace depth. */
function productionRange(text) {
  const start = text.search(/"production"\s*:\s*\{/);
  if (start === -1) return null;
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}' && --depth === 0) return [start, i];
  }
  return [start, text.length];
}

/** Every placeholder in the given files (only the env.production block where `section` says so). */
export function findPlaceholders(files) {
  const found = [];
  for (const { path, text, section } of files) {
    const range = section === 'env.production' ? productionRange(text) : [0, text.length];
    if (!range) continue;
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (match.index < range[0] || match.index > range[1]) continue;
      const line = text.slice(0, match.index).split('\n').length;
      found.push({ path, line, token: match[0] });
    }
  }
  return found;
}

export const RELEASE_FILES = [
  { path: 'apps/api/wrangler.jsonc', section: 'env.production' },
  { path: 'apps/web/wrangler.jsonc', section: 'env.production' },
  { path: 'apps/web/src/legal/operator.ts' },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = RELEASE_FILES.map(f => ({ ...f, text: readFileSync(new URL(f.path, `file://${root}/`), 'utf8') }));
  const found = findPlaceholders(files);
  if (found.length > 0) {
    console.error('Not ready for production. Fill in these placeholders first (see DEPLOY.md):');
    for (const f of found) console.error(`  ${f.path}:${f.line}  ${f.token}`);
    process.exit(1);
  }
  console.log('Release check passed: no placeholders left.');
}
