import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Test-only values; real secrets come from .dev.vars locally and `wrangler secret put` in production.
            BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
            GITHUB_CLIENT_ID: 'test-github-client-id',
            GITHUB_CLIENT_SECRET: 'test-github-client-secret',
          },
        },
      }),
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/apply-migrations.ts'] },
  };
});
