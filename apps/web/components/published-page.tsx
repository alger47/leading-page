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
  // Logical asset refs never reach an <img>: map them to the object-store
  // public base when the host configures one, else the self-hosted placeholder
  // (CSP `img-src 'self'`-safe). Kept inline so this shell imports ONLY the
  // public renderer (§5.7 published-page isolation contract).
  const assetUrlFor = (ref: string) => {
    if (typeof ref !== 'string' || !ref.startsWith('asset:')) return ref;
    const base = process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL;
    return base ? `${base.replace(/\/+$/, '')}/${encodeURIComponent(ref)}` : `/assets/asset/${encodeURIComponent(ref)}`;
  };
  return <Render schema={schema} assetUrlFor={assetUrlFor} />;
}