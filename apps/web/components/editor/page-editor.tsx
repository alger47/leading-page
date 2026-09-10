'use client';

/**
 * Page editor (Phase 8).
 *
 * A local draft Schema is mutated by the sidebar controls (section fields,
 * reorder, theme) and rendered live through the SAME renderer as production.
 * Saving POSTs the draft to /api/v1/pages/:pageId/versions with the base
 * version; the server runs L1 structural (blocks with 422 E-VAL-L1) and L2
 * advisory validation. Regenerating a section saves a brand-new version.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';
import { PagePreview } from '@/components/page-preview';
import { ContentEditor } from './content-editor';
import { ThemePicker, type ThemePresetView } from './theme-picker';
import {
  draftFromContent,
  moveInArray,
  removeAt,
  sectionTypeLabel,
  setAt,
  type Path,
} from './editor-utils';

export interface EditorAsset {
  id: string;
  kind: string;
  source: string;
  url: string;
  alt?: string;
  category?: string;
}

export interface PageEditorProps {
  projectId: string;
  pageId: string;
  version: { versionNumber: number; schemaVersion: string; content: unknown };
}

interface ValidationIssue {
  path?: string;
  message?: string;
  code?: string;
}

interface JobPollState {
  sectionId: string;
  jobId: string;
  status: string;
}

export function PageEditor({ pageId, version }: PageEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, unknown>>(() => draftFromContent(version.content));
  const [selected, setSelected] = useState<string | null>(null);
  const [assets, setAssets] = useState<EditorAsset[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [regenJob, setRegenJob] = useState<JobPollState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const firstSelected = useRef(true);

  const sections = useMemo(() => (Array.isArray(draft.sections) ? (draft.sections as Array<Record<string, unknown>>) : []), [draft]);

  useEffect(() => {
    if (firstSelected.current && sections.length > 0) {
      setSelected(String(sections[0].id ?? ''));
      firstSelected.current = false;
    }
  }, [sections]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ assets?: EditorAsset[]; error?: { message?: string } }>('/api/v1/assets');
      if (!alive) return;
      if (res.status === 200 && res.body.assets) setAssets(res.body.assets);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sectionIndex = useMemo(() => {
    if (selected === null) return -1;
    return sections.findIndex((s) => s.id === selected);
  }, [sections, selected]);

  const selectedContent = sectionIndex >= 0 && sections[sectionIndex] ? (sections[sectionIndex].content as Record<string, unknown>) ?? {} : null;

  const update = useCallback((path: Path, value: unknown) => {
    setDraft((doc) => setAt(doc, path, value) as Record<string, unknown>);
    setSaveError(null);
    setIssues([]);
  }, []);

  const remove = useCallback((path: Path) => {
    setDraft((doc) => removeAt(doc, path) as Record<string, unknown>);
    setSaveError(null);
    setIssues([]);
  }, []);

  const move = useCallback((from: number, to: number) => {
    setDraft((doc) => moveInArray(doc, ['sections'], from, to) as Record<string, unknown>);
  }, []);

  const applyTheme = useCallback((preset: ThemePresetView) => {
    setDraft((doc) => ({
      ...doc,
      theme: { preset: preset.preset, font: preset.theme.font, primaryColor: preset.theme.primaryColor, radius: preset.theme.radius, density: preset.theme.density },
    }));
    setSaveError(null);
    setIssues([]);
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(draftFromContent(version.content));
    setSaveError(null);
    setIssues([]);
    setWarnings([]);
    setNotice(null);
  }, [version]);

  async function saveDraft() {
    setSaving(true);
    setSaveError(null);
    setIssues([]);
    setNotice(null);
    try {
      const res = await apiFetch<{
        version?: { versionNumber: number };
        warnings?: ValidationIssue[];
        error?: { code?: string; message?: string; details?: { issues?: ValidationIssue[] } };
      }>(`/api/v1/pages/${encodeURIComponent(pageId)}/versions`, {
        method: 'POST',
        body: JSON.stringify({ baseVersion: version.versionNumber, schemaVersion: version.schemaVersion, content: draft }),
      });

      if (res.status === 200 && res.body.version) {
        setWarnings(res.body.warnings ?? []);
        setNotice(`Saved as version ${res.body.version.versionNumber}.`);
        router.refresh();
        return;
      }

      if (res.status === 409) {
        setSaveError(res.body.error?.message ?? 'Your draft is based on an outdated version — reload to continue.');
        router.refresh();
        return;
      }

      const err = res.body.error;
      setSaveError(err?.message ?? 'Could not save this draft.');
      if (err?.code === 'E-VAL-L1') setIssues(err.details?.issues ?? []);
    } catch {
      setSaveError('Network error. Could not save the draft.');
    } finally {
      setSaving(false);
    }
  }

  /** Poll a section-regeneration job until terminal, then refresh so the new
   *  version (with the regenerated section) becomes the editor's base. */
  async function trackRegen(sectionId: string, jobId: string) {
    setRegenJob({ sectionId, jobId, status: 'QUEUED' });
    setBusy(true);
    let status = 'QUEUED';
    for (;;) {
      const res = await apiFetch<{ job?: { status: string; errorCode?: string; errorMessage?: string } }>(
        `/api/v1/generation-jobs/${encodeURIComponent(jobId)}`,
      );
      status = res.body.job?.status ?? status;
      setRegenJob((prev) => (prev && prev.jobId === jobId ? { ...prev, status } : prev));
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (status === 'COMPLETED') {
      setNotice(`Section regenerated — saved as a new version.`);
      router.refresh();
    } else {
      setRegenJob(null);
      setBusy(false);
      setRegeneratingId(null);
      setSaveError((await apiFetch<{ job?: { errorMessage?: string; errorCode?: string } }>(`/api/v1/generation-jobs/${encodeURIComponent(jobId)}`)).body.job?.errorMessage ?? 'Section regeneration failed.');
    }
  }

  async function regenerate(sectionId: string) {
    setRegeneratingId(sectionId);
    try {
      const res = await apiFetch<{ job?: { jobId?: string; status?: string }; error?: { message?: string; code?: string } }>(
        `/api/v1/pages/${encodeURIComponent(pageId)}/sections/${encodeURIComponent(sectionId)}/regenerate`,
        { method: 'POST', body: '{}' },
      );
      if (res.status !== 202 && res.status !== 200) {
        setSaveError(res.body?.error?.message ?? 'Could not start the regeneration.');
        setRegeneratingId(null);
        return;
      }
      const jobId = res.body?.job?.jobId;
      if (jobId) {
        await trackRegen(sectionId, jobId);
      } else {
        setSaveError('Regeneration started without a job id.');
        setRegeneratingId(null);
      }
    } catch {
      setSaveError('Network error. Could not start the regeneration.');
      setRegeneratingId(null);
    }
  }

  const assetsList = assets ?? [];
  const theme = draft.theme as { preset?: string } | undefined;

  return (
    <div className="editor-layout">
      <aside className="editor-sidebar">
        <div className="panel">
          <h2 className="panel-title">Theme</h2>
          <ThemePicker current={theme} onApply={applyTheme} />
        </div>

        <div className="panel">
          <h2 className="panel-title">Sections</h2>
          <ul className="section-list">
            {sections.map((s, index) => {
              const id = String(s.id ?? index);
              const active = id === selected;
              const isFirst = index === 0;
              const isLast = index === sections.length - 1;
              return (
                <li key={id} className={`section-row${active ? ' active' : ''}`}>
                  <button type="button" className="section-main" onClick={() => setSelected(id)}>
                    <span className="section-type">{sectionTypeLabel(s.type)}</span>
                    <span className="section-id">{id}</span>
                  </button>
                  <span className="section-actions">
                    <button type="button" title="Move up" disabled={isFirst} onClick={() => move(index, index - 1)}>
                      ↑
                    </button>
                    <button type="button" title="Move down" disabled={isLast} onClick={() => move(index, index + 1)}>
                      ↓
                    </button>
                    <button type="button" title="Regenerate this section" disabled={busy || regeneratingId !== null} onClick={() => void regenerate(id)}>
                      {regeneratingId === id ? '…' : '↻'}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <main className="editor-canvas">
        <div className="editor-toolbar">
          <span className="editor-context">
            Editing <strong>v{version.versionNumber}</strong>
            {regenJob ? ` — regenerating ${regenJob.sectionId} (${regenJob.status})` : ''}
          </span>
          <span className="toolbar-actions">
            <button type="button" className="secondary-btn" onClick={resetDraft} disabled={busy}>
              Discard
            </button>
            <button type="button" className="primary-btn" onClick={() => void saveDraft()} disabled={saving || busy}>
              {saving ? 'Saving…' : 'Save as new version'}
            </button>
          </span>
        </div>

        <div className="editor-body">
          <div className="editor-inspector">
            {selectedContent && sectionIndex >= 0 ? (
              <div className="inspector-panel">
                <h3 className="inspector-title">
                  {sectionTypeLabel(sections[sectionIndex].type)}
                  <span className="inspector-id">{selected}</span>
                </h3>
                <ContentEditor
                  content={selectedContent}
                  path={['sections', sectionIndex, 'content']}
                  onUpdate={update}
                  onRemove={remove}
                  assets={assetsList}
                />
              </div>
            ) : (
              <p className="editor-note">Select a section to edit its content.</p>
            )}

            {saveError && (
              <div className="error-box" role="alert">
                <p className="error-text">{saveError}</p>
                {issues.length > 0 && (
                  <ul className="issue-list">
                    {issues.map((issue, i) => (
                      <li key={i}>
                        <code>{issue.path}</code> — {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {notice && <p className="saved-note">{notice}</p>}
            {warnings.length > 0 && (
              <div className="warn-box">
                <p className="warn-text">Saved with advisory warnings:</p>
                <ul className="issue-list">
                  {warnings.map((w, i) => (
                    <li key={i}>
                      <code>{w.path}</code> — {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="editor-preview">
            <PagePreview schema={draft} />
          </div>
        </div>
      </main>

      <style jsx>{`
        .editor-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
        .editor-sidebar { display: grid; gap: 16px; position: sticky; top: 16px; }
        .panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 14px; }
        .panel-title { margin: 0 0 10px; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); }
        .section-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .section-row { display: flex; align-items: center; gap: 4px; border: 1px solid transparent; border-radius: var(--radius-sm); padding: 2px; }
        .section-row.active { border-color: var(--color-primary); background: var(--color-primary-soft); }
        .section-main { flex: 1; text-align: start; background: none; border: 0; cursor: pointer; display: grid; gap: 1px; padding: 4px 6px; }
        .section-type { font-weight: 600; font-size: 0.875rem; }
        .section-id { font-size: 0.6875rem; color: var(--color-text-muted); font-family: ui-monospace, monospace; }
        .section-actions button, .toolbar-actions button { cursor: pointer; }
        .section-actions button { width: 22px; height: 22px; border: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-sm); font-size: 0.75rem; }
        .section-actions button:disabled { opacity: 0.4; cursor: default; }
        .editor-canvas { min-width: 0; display: grid; gap: 12px; }
        .editor-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .editor-context { font-size: 0.875rem; color: var(--color-text-muted); }
        .toolbar-actions { display: flex; gap: 8px; }
        .primary-btn, .secondary-btn { padding: 8px 14px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface); font-size: 0.875rem; }
        .primary-btn { background: var(--color-primary); color: var(--color-on-primary); border-color: transparent; }
        .editor-body { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px; align-items: start; }
        .editor-preview { min-width: 0; }
        .editor-inspector { position: sticky; top: 16px; display: grid; gap: 12px; max-height: calc(100vh - 180px); overflow: auto; }
        .inspector-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 14px; }
        .inspector-title { margin: 0 0 10px; font-size: 0.9rem; display: flex; align-items: baseline; gap: 8px; }
        .inspector-id { font-size: 0.6875rem; color: var(--color-text-muted); font-family: ui-monospace, monospace; }
        .editor-note { font-size: 0.875rem; color: var(--color-text-muted); }
        .error-box { border: 1px solid #fca5a5; background: #fef2f2; border-radius: var(--radius-sm); padding: 10px 12px; }
        .error-text { margin: 0; color: #b91c1c; font-size: 0.875rem; }
        .saved-note { color: #166534; font-size: 0.875rem; margin: 0; }
        .warn-box { border: 1px solid #fcd34d; background: #fffbeb; border-radius: var(--radius-sm); padding: 10px 12px; }
        .warn-text { margin: 0 0 6px; color: #92400e; font-size: 0.875rem; }
        .issue-list { margin: 8px 0 0; padding-left: 18px; font-size: 0.8125rem; color: var(--color-text); }
        .issue-list li { margin-bottom: 2px; }
      `}</style>
    </div>
  );
}