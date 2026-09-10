/**
 * esbuild bundle of the visual-qa CLI (Phase 12).
 *
 * The CLI runs under plain Node (CI-friendly). ui-components/design-system are
 * inlined from source with the automatic JSX runtime so the bundle is one
 * self-contained ESM file (react/react-dom stay external, resolved at runtime).
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))],
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
  outfile: fileURLToPath(new URL('../dist/cli.mjs', import.meta.url)),
  logLevel: 'info',
});