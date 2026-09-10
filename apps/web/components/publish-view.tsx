'use client';

/**
 * Publish / unpublish controls (Phase 10 — J5).
 *
 * Shows the live state (host, URL, version) and lets the owner publish any
 * immutable version (default latest) or downgrade back to draft. The server
 * runs the L1+L2 publish gate; mutations refresh the route so page detail and
 * this view stay in sync with the latest snapshot.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';

export interface PublishViewState {
  published: { host: string; url: string; versionNumber: number; publishedAt: string } | null;
  versions: number[];
  latestVersion: number | null;
}

export function PublishView({ pageId, initial }: { pageId: string; initial: PublishViewState }) {
  const router = useRouter();
  const [version, setVersion] = useState<number>(initial.latestVersion ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (initial.versions.length === 0) return null;

  async function publish() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ published?: PublishViewState['published']; error?: { message?: string; code?: string } }>(
        `/api/v1/pages/${encodeURIComponent(pageId)}/publish`,
        { method: 'POST', body: JSON.stringify({ versionNumber: version }) },
      );
      if (res.status === 200 && res.body.published) {
        setNotice(`Published version ${res.body.published.versionNumber}.`);
        router.refresh();
      } else {
        setError(res.body?.error?.message ?? 'Could not publish.');
      }
    } catch {
      setError('Network error. Could not publish.');
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ published?: unknown; error?: { message?: string } }>(
        `/api/v1/pages/${encodeURIComponent(pageId)}/publish`,
        { method: 'DELETE' },
      );
      if (res.status === 200) {
        setNotice('Unpublished. The page is a draft again; history is untouched.');
        router.refresh();
      } else {
        setError(res.body?.error?.message ?? 'Could not unpublish.');
      }
    } catch {
      setError('Network error. Could not unpublish.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publish">
      {initial.published ? (
        <div className="live">
          <strong>Live at <a href={initial.published.url} target="_blank" rel="noopener noreferrer" className="url">{initial.published.url}</a></strong>
          <p className="hint">
            Published version {initial.published.versionNumber} on {initial.published.host}.
          </p>
        </div>
      ) : (
        <p className="hint">This page is a draft. Publish a validated version to put it on a public host.</p>
      )}

      <div className="controls">
        <label>
          Version
          <select value={version} onChange={(e) => setVersion(Number(e.target.value))}>
            {initial.versions.map((v) => (
              <option key={v} value={v}>
                v{v}{v === initial.latestVersion ? ' (latest)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="publish-btn" onClick={() => void publish()} disabled={busy || version < 1}>
          {busy ? 'Working…' : 'Publish'}
        </button>
        {initial.published && (
          <button type="button" className="unpublish-btn" onClick={() => void unpublish()} disabled={busy}>
            {busy ? 'Working…' : 'Unpublish'}
          </button>
        )}
      </div>

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <style jsx>{`
        .publish { display: grid; gap: 14px; }
        .controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .controls label { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; }
        .controls select { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
        .publish-btn, .unpublish-btn { padding: 9px 16px; border: 0; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; }
        .publish-btn { background: var(--color-primary); color: var(--color-on-primary); }
        .unpublish-btn { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }
        .publish-btn:disabled, .unpublish-btn:disabled { opacity: 0.6; cursor: default; }
        .live { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 14px 16px; background: var(--color-surface); }
        .hint { color: var(--color-text-muted); font-size: 0.875rem; margin-top: 6px; }
        .notice { color: #166534; font-size: 0.875rem; margin: 0; }
        .error { color: #b91c1c; font-size: 0.875rem; margin: 0; }
        .url { color: var(--color-primary); }
      `}</style>
    </div>
  );
}