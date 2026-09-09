import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/real-engine.*.test.ts', 'tests/**/real-bullmq.*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});