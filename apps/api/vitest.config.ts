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
            // wrangler.jsonc defaults DEV_AUTH to "false" (fail closed); tests use the dev header like `pnpm dev` does.
            DEV_AUTH: 'true',
            // Test-only values; real secrets come from .dev.vars locally and `wrangler secret put` in production.
            BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
            GITHUB_CLIENT_ID: 'test-github-client-id',
            GITHUB_CLIENT_SECRET: 'test-github-client-secret',
            // GitHub user ids 1 and 2 are Moderators in tests.
            MODERATOR_GITHUB_IDS: '1, 2',
            // GitHub user id 3 has unlimited Quota in tests.
            UNLIMITED_QUOTA_GITHUB_IDS: '3',
          },
        },
      }),
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/apply-migrations.ts'] },
  };
});
