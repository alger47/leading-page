'use client';

import { Render } from '@landing-ai/ui-components';
import { resolveAssetUrl } from '@/lib/assets';

export interface PreviewShellProps {
  schema: Record<string, unknown>;
  /**
   * Draft-scoped preview: when set, the logical `asset:` refs resolve through
   * the authenticated /api/v1/assets/raw proxy bound to THIS page, so draft
   * rasters render their real bytes without ever being public (§10.5). The
   * published page keeps the purely-public resolver (no pageId).
   */
  pageId?: string;
}

function draftAssetUrlFor(pageId: string) {
  return (ref: string): string =>
    typeof ref === 'string' && ref.startsWith('asset:')
      ? `/api/v1/assets/raw?ref=${encodeURIComponent(ref)}&pageId=${encodeURIComponent(pageId)}`
      : ref;
}

export function PagePreview({ schema, pageId }: PreviewShellProps) {
  return (
    <div className="preview">
      <Render schema={schema} assetUrlFor={pageId ? draftAssetUrlFor(pageId) : resolveAssetUrl} />
      <style jsx>{`
        .preview { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
      `}</style>
    </div>
  );
}