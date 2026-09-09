import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@landing-ai/design-system': fileURLToPath(new URL('../design-system/src/index.ts', import.meta.url)),
      '@landing-ai/page-schema': fileURLToPath(new URL('../page-schema/src/index.ts', import.meta.url)),
    },
  },
});