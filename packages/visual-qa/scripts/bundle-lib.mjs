/**
 * esbuild bundle of the visual-qa LIBRARY (Phase 12).
 *
 * The library is consumed at runtime by Node (Next route handlers via
 * serverExternalPackages) and by the webpack pipeline. Its own dependencies
 * (ui-components/design-system) emit extensionless ESM imports that bare Node
 * cannot resolve, so the library ships as ONE self-contained ESM file.
 * react/react-dom/playwright-core stay external (resolved at runtime).
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  jsx: 'automatic',
  alias: {
    '@landing-ai/design-system': fileURLToPath(new URL('../../design-system/src/index.ts', import.meta.url)),
    '@landing-ai/ui-components': fileURLToPath(new URL('../../ui-components/src/index.ts', import.meta.url)),
  },
  external: ['react', 'react-dom', 'playwright-core'],
  outfile: fileURLToPath(new URL('../dist/index.mjs', import.meta.url)),
  logLevel: 'info',
});