import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // Real PostgreSQL round trips (and one scratch database per run in the M4 -> M5 migration
    // test): allow more than the 5 s unit-test default, files still run in parallel.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
