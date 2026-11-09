import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E (docs/TEST_STRATEGY.md). Prerequisites: PostgreSQL running (`pnpm db:up`) and a
 * build (`pnpm build`). The web app is started here; the API server is started by the tests
 * themselves (e2e/server.ts) so that a test can stop and restart it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
