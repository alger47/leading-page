import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@landing-ai/database': fileURLToPath(new URL('../../packages/database/src/index.ts', import.meta.url)),
      '@landing-ai/design-system': fileURLToPath(new URL('../../packages/design-system/src/index.ts', import.meta.url)),
      '@landing-ai/page-schema': fileURLToPath(new URL('../../packages/page-schema/src/index.ts', import.meta.url)),
      '@landing-ai/ui-components': fileURLToPath(new URL('../../packages/ui-components/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts', 'node_modules/**'],
    environment: 'node',
    testTimeout: 30_000,
  },
});