import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4321', trace: 'retain-on-failure' },
  // A mid-range phone, as in the quality bar (ADR 0004).
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://localhost:4321/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Lets scripts/serve.mjs stop the API and preview servers (the default SIGKILL would orphan them).
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
