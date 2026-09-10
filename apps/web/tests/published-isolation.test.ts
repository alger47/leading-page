/**
 * Published-page isolation (Phase 10 — J5 acceptance: "published page ships
 * zero dashboard/editor JS", §5.7). Source-level guarantees:
 *   - the public route is server-only: no 'use client', no dashboard/editor or
 *     dashboard-component imports;
 *   - the one allowed client shell (published-page.tsx) imports ONLY the
 *     public ui-components renderer;
 *   - drafts/private dashboard routes are noindex, published pages indexable,
 *     and the snapshot renders through the shared deterministic renderer.
 * The remote-served budget (gzipped client JS ≤ 90 KB) is measured by
 * `pnpm test:budget` against the real `next build` output.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSrc = readFileSync(new URL('../app/(published)/[host]/page.tsx', import.meta.url), 'utf8');
const shellSrc = readFileSync(new URL('../components/published-page.tsx', import.meta.url), 'utf8');
const dashboardLayout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8');

describe('published page isolation', () => {
  it('the public route is server-only and imports nothing dashboard/editor', () => {
    expect(routeSrc).not.toMatch(/^\s*['"]use client['"];?\s*$/m);
    expect(routeSrc).not.toMatch(
      /@\/components\/(editor|generation-view|versions-view|publish-view|logout-button|page-editor)/,
    );
    expect(routeSrc).not.toMatch(/@\/components\/(?!published-page)[^']*'/);
  });

  it('the only client shell renders the snapshot with the public renderer, nothing else', () => {
    expect(shellSrc).toMatch(/^\s*['"]use client['"];?\s*$/m);
    expect(shellSrc).toContain("from '@landing-ai/ui-components'");
    expect(shellSrc).not.toMatch(/@\/lib|@\/components|@landing-ai\/database|@landing-ai\/page-schema/);
  });

  it('published pages are indexable; dashboard (draft) routes are noindex', () => {
    expect(routeSrc).toMatch(/index:\s*true/);
    expect(dashboardLayout).toMatch(/index:\s*false/);
  });
});