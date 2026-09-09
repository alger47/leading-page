import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: './tests/global-setup.ts',
    // tests share one Postgres schema; run files serially so truncation is deterministic
    fileParallelism: false,
  },
});