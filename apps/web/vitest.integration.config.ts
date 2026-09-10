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
      '@landing-ai/visual-qa': fileURLToPath(new URL('../../packages/visual-qa/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // DB-backed API integration + the real-engine J1 e2e (skipped unless the
    // ai-engine venv exists). globalSetup replays migrations on a clean schema.
    include: ['tests/**/*.integration.test.ts', 'tests/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    globalSetup: './tests/global-setup.ts',
    fileParallelism: false,
  },
});