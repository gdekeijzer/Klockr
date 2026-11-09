import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // One shared PostgreSQL: files run one after another (the M4 -> M5 migration test creates
    // and drops a scratch database, which must not stall concurrent files).
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
