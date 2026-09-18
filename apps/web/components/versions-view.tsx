'use client';

/**
 * Version history & restore (Phase 9 — J4).
 *
 * Lists all immutable versions, compares any two (metadata + section diff
 * summary, computed server-side), and restores a previous version — which the
 * server persists as a NEW version (restore copies, never rewrites). Every
 * mutation refreshes the route so the editor remounts on the new latest.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';
import type { SectionDiffEntry, VersionDiffSummary } from '@/lib/versions-diff';

export interface VersionMeta {
  versionNumber: number;
  schemaVersion: string;
  createdAt: string;
  createdBy: string | null;
}

interface VersionsViewProps {
  pageId: string;
  currentVersion: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const ACTION_LABEL: Record<SectionDiffEntry['action'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

export function VersionsView({ pageId, currentVersion }: VersionsViewProps) {
  const router = useRouter();
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const [from, setFrom] = useState<number>(currentVersion);
  const [to, setTo] = useState<number>(-1);
  const [diff, setDiff] = useState<{ from: number; to: number; diff: VersionDiffSummary } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ versions?: VersionMeta[]; error?: { message?: string } }>(`/api/v1/pages/${encodeURIComponent(pageId)}/versions`);
      if (!alive) return;
      if (res.status === 200 && res.body.versions) {
        setVersions(res.body.versions);
        setFrom(currentVersion);
        const target = [...res.body.versions]
          .sort((a, b) => b.versionNumber - a.versionNumber)
          .find((v) => v.versionNumber !== currentVersion);
        setTo(target ? target.versionNumber : -1);
      } else {
        setError(res.body?.error?.message ?? 'Could not load the version history.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [pageId, currentVersion]);

  const runCompare = useCallback(async () => {
    setError(null);
    if (from < 1 || to < 1 || from === to) {
      setError('Choose two different versions to compare.');
      return;
    }
    const res = await apiFetch<{ from: number; to: number; diff: VersionDiffSummary }>(
      `/api/v1/pages/${encodeURIComponent(pageId)}/versions/compare?from=${from}&to=${to}`,
    );
    if (res.status === 200) setDiff(res.body);
    else setError('Could not run the comparison.');
  }, [pageId, from, to]);

  const restore = useCallback(
    async (versionNumber: number) => {
      setRestoring(versionNumber);
      setError(null);
      setNotice(null);
      try {
        const res = await apiFetch<{ version?: { versionNumber: number; restoredFrom: number }; error?: { message?: string; code?: string } }>(
          `/api/v1/pages/${encodeURIComponent(pageId)}/versions/${versionNumber}/restore`,
          { method: 'POST', body: '{}' },
        );
        if (res.status === 200 && res.body.version) {
          setNotice(`Version ${versionNumber} restored as version ${res.body.version.versionNumber}.`);
          router.refresh();
        } else {
          setError(res.body?.error?.message ?? 'Could not restore that version.');
        }
      } catch {
        setError('Network error. Could not restore the version.');
      } finally {
        setRestoring(null);
      }
    },
    [pageId, router],
  );

  const rows = useMemo(
    () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions],
  );

  return (
    <div className="versions">
      <div className="versions-grid">
        <div className="versions-list-panel">
          <h3 className="panel-title">History</h3>
          <ul className="version-list">
            {rows.map((version) => {
              const isCurrent = version.versionNumber === currentVersion;
              return (
                <li key={version.versionNumber} className={`version-row${isCurrent ? ' current' : ''}`}>
                  <div className="version-main">
                    <span className="version-number">
                      v{version.versionNumber}
                      {isCurrent ? <span className="version-tag">current</span> : null}
                    </span>
                    <span className="version-meta">
                      {formatDate(version.createdAt)}
                      {version.createdBy ? ` · by ${version.createdBy}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={restoring !== null}
                    onClick={() => void restore(version.versionNumber)}
                  >
                    {restoring === version.versionNumber ? 'Restoring…' : 'Restore'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="versions-compare-panel">
          <h3 className="panel-title">Compare</h3>

          {versions.length >= 2 ? (
            <>
              <div className="compare-controls">
                <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                  {versions.map((v) => (
                    <option key={v.versionNumber} value={v.versionNumber}>
                      v{v.versionNumber}
                    </option>
                  ))}
                </select>
                <span className="compare-sep">vs</span>
                <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
                  {versions.map((v) => (
                    <option key={v.versionNumber} value={v.versionNumber}>
                      v{v.versionNumber}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void runCompare()}
                  disabled={from === to || from < 1 || to < 1}
                >
                  Compare
                </button>
              </div>
              {from === to && <p className="version-hint">Pick two different versions to see what changed.</p>}
            </>
          ) : (
            <p className="version-hint">
              Compare needs at least two versions. Edit this page in the Editor and save to create version 2.
            </p>
          )}

          {diff && (
            <div className="diff">
              <p className="diff-meta">
                <strong>Title:</strong> {diff.diff.metadata.title.previous ?? '—'} → {diff.diff.metadata.title.current ?? '—'}
                {diff.diff.metadata.theme.changed ? ' · theme changed' : ''}
                {diff.diff.metadata.locale.changed ? ' · locale changed' : ''}
              </p>
              <p className="diff-counts">
                {diff.diff.counts.added} added · {diff.diff.counts.removed} removed · {diff.diff.counts.changed} changed ·{' '}
                {diff.diff.counts.unchanged} unchanged
              </p>
              <ul className="diff-list">
                {diff.diff.sections.map((section) => (
                  <li key={section.id} className={`diff-row action-${section.action}`}>
                    <span className="diff-badge">{ACTION_LABEL[section.action]}</span>
                    <code className="diff-id">{section.id}</code>
                    <span className="diff-type">{section.type}</span>
                    {section.action === 'changed' && section.changedSlots && section.changedSlots.length > 0 && (
                      <span className="diff-slots">
                        {section.changedSlots.map((slot) => (
                          <code key={slot}>{slot}</code>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="version-error">{error}</p>}
          {notice && <p className="version-notice">{notice}</p>}
        </div>
      </div>

      <style jsx>{`
        .versions { display: grid; gap: 12px; }
        .versions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
        .versions-list-panel, .versions-compare-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 14px; }
        .panel-title { margin: 0 0 10px; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); }
        .version-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .version-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid transparent; border-radius: var(--radius-sm); padding: 8px 10px; }
        .version-row.current { border-color: var(--color-primary); background: var(--color-primary-soft); }
        .version-main { display: grid; gap: 2px; }
        .version-number { font-weight: 600; font-size: 0.9rem; font-family: ui-monospace, monospace; }
        .version-tag { margin-left: 6px; font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-on-primary); background: var(--color-primary); border-radius: 999px; padding: 1px 8px; }
        .version-meta { font-size: 0.75rem; color: var(--color-text-muted); }
        .secondary-btn, .primary-btn { padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface); font-size: 0.8125rem; cursor: pointer; }
        .primary-btn { background: var(--color-primary); color: var(--color-on-primary); border-color: transparent; }
        .primary-btn:disabled, .secondary-btn:disabled { opacity: 0.5; cursor: default; }
        .compare-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .compare-controls select { padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface); font-size: 0.8125rem; font-family: ui-monospace, monospace; }
        .compare-sep { color: var(--color-text-muted); font-size: 0.8125rem; }
        .diff { margin-top: 12px; display: grid; gap: 8px; }
        .diff-meta { margin: 0; font-size: 0.8125rem; }
        .diff-counts { margin: 0; font-size: 0.75rem; color: var(--color-text-muted); }
        .diff-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
        .diff-row { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; }
        .diff-badge { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 4px; padding: 1px 6px; }
        .action-added .diff-badge { background: #dcfce7; color: #166534; }
        .action-removed .diff-badge { background: #fee2e2; color: #b91c1c; }
        .action-changed .diff-badge { background: #fef3c7; color: #92400e; }
        .action-unchanged .diff-badge { background: #f1f5f9; color: #475569; }
        .diff-id { font-family: ui-monospace, monospace; font-size: 0.75rem; }
        .diff-type { color: var(--color-text-muted); font-size: 0.75rem; }
        .diff-slots { display: inline-flex; gap: 4px; }
        .diff-slots code { font-family: ui-monospace, monospace; font-size: 0.6875rem; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 4px; padding: 0 4px; }
        .version-error { color: #b91c1c; font-size: 0.8125rem; margin: 8px 0 0; }
        .version-notice { color: #166534; font-size: 0.8125rem; margin: 8px 0 0; }
        .version-hint { color: var(--color-text-muted); font-size: 0.8125rem; margin: 8px 0 0; }
      `}</style>
    </div>
  );
}