'use client';

import { Render } from '@landing-ai/ui-components';
import { resolveAssetUrl } from '@/lib/assets';

export interface PreviewShellProps {
  schema: Record<string, unknown>;
}

export function PagePreview({ schema }: PreviewShellProps) {
  return (
    <div className="preview">
      <Render schema={schema} assetUrlFor={resolveAssetUrl} />
      <style jsx>{`
        .preview { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
      `}</style>
    </div>
  );
}