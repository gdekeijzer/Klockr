import { defineConfig, devices } from '@playwright/test';

/**
 * Scaffold only. Browser E2E journeys start in M1 (docs/TEST_STRATEGY.md).
 * Run with `pnpm --filter @klockr/web exec playwright test` once e2e specs exist.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: true,
  },
});
