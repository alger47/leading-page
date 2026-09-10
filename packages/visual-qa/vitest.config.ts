import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@landing-ai/design-system': fileURLToPath(new URL('../design-system/src/index.ts', import.meta.url)),
      '@landing-ai/ui-components': fileURLToPath(new URL('../ui-components/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});