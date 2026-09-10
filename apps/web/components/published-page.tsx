'use client';

/**
 * Published page renderer (Phase 10 — J5).
 *
 * The public renderer (ui-components) relies on ThemeProvider context, which
 * React Server Components do not support, so this thin shell is the ONLY
 * client component on a published route. It imports nothing from the
 * dashboard/editor subtree: the payload shipped to published pages is exactly
 * the app shell + the deterministic public renderer — zero dashboard/editor JS
 * (enforced by the budget script + isolation test, §5.7).
 */

import { Render } from '@landing-ai/ui-components';

export function PublishedPageContent({ schema }: { schema: Record<string, unknown> }) {
  return <Render schema={schema} />;
}