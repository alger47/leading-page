'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';
import { extractBriefAnalysis, extractGenerationMode, isIncompleteBrief, type GenerationMode } from '@/lib/brief-analysis';

const LOCALES = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

const TONES = [
  'warm-professional',
  'cool-modern',
  'bold-creative',
  'minimal-clean',
  'playful',
  'luxury',
  'bold-minimal',
];

const STAGE_LABELS: Record<string, string> = {
  'job.started': 'Started',
  'stage.drafting': 'Drafting content…',
  'stage.validating': 'Validating the schema…',
  'stage.rendering': 'Rendering…',
  'job.completed': 'Done',
};

interface JobView {
  jobId: string;
  status: string;
  attemptsMade: number;
  errorCode: string | null;
  errorMessage: string | null;
  events?: Array<{ type: string; at: string; detail?: string }>;
  result?: unknown;
  briefIncomplete?: boolean;
  demoMode?: GenerationMode | null;
}

export interface GenerationViewProps {
  projectId: string;
  pageId: string;
  hasVersion: boolean;
  activeJob: { id: string; status: string; briefIncomplete?: boolean; demoMode?: GenerationMode | null } | null;
}

const BRIEF_MIN_LENGTH = 10;

export function GenerationView({ projectId, pageId, hasVersion, activeJob }: GenerationViewProps) {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [locale, setLocale] = useState<'ar' | 'fr' | 'en'>('fr');
  const [tone, setTone] = useState('warm-professional');
  const [generateImages, setGenerateImages] = useState(false);
  const [job, setJob] = useState<JobView | null>(() =>
    activeJob
      ? { jobId: activeJob.id, status: activeJob.status, attemptsMade: 0, errorCode: null, errorMessage: null, briefIncomplete: activeJob.briefIncomplete, demoMode: activeJob.demoMode }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const running = job !== null && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status);
  const failed = job !== null && job.status === 'FAILED';
  const cancelled = job !== null && job.status === 'CANCELLED';
  const completed = job !== null && job.status === 'COMPLETED';

  const poll = useCallback(async () => {
    if (!job) return;
    const res = await apiFetch<{ job?: JobView; error?: { code?: string; message?: string } }>(
      `/api/v1/generation-jobs/${encodeURIComponent(job.jobId)}`,
    );
    if (res.status === 200 && res.body.job) {
      const next = res.body.job as JobView;
      setJob({ ...next, briefIncomplete: isIncompleteBrief(next.events), demoMode: extractGenerationMode(next.events) ?? next.demoMode });
      if (next.status === 'COMPLETED') {
        router.refresh();
      }
    } else {
      setError(res.body?.error?.message ?? 'Lost connection to the generator.');
    }
  }, [job, router]);

  useEffect(() => {
    if (!job || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return;
    const timer = setInterval(() => {
      void poll();
    }, 2000);
    return () => clearInterval(timer);
  }, [job, poll, running]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ jobId?: string; status?: string; error?: { code?: string; message?: string } }>(
        '/api/v1/generate',
        { method: 'POST', body: JSON.stringify({ projectId, pageId, brief, locale, tone, generateImages }) },
      );
      if (res.status !== 202 && res.status !== 200) {
        setError(res.body?.error?.message ?? 'Could not start generation.');
        return;
      }
      setJob({ jobId: res.body.jobId ?? '', status: res.body.status ?? 'QUEUED', attemptsMade: 0, errorCode: null, errorMessage: null });
    } catch {
      setError('Network error. Could not reach the generator.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    setCancelling(true);
    try {
      const res = await apiFetch<{ job?: JobView; cancelled?: boolean; error?: { message?: string } }>(
        `/api/v1/generation-jobs/${encodeURIComponent(job.jobId)}`,
        { method: 'DELETE' },
      );
      if (res.status === 200 && res.body.job) setJob(res.body.job);
      else setError(res.body?.error?.message ?? 'Could not cancel the job.');
    } finally {
      setCancelling(false);
    }
  }

  const lastEvent = job?.events?.slice(-1)[0]?.type;
  const analysis = job?.events ? extractBriefAnalysis(job.events) : null;

  return (
    <section className="generation">
      {hasVersion ? (
        <div className="generated">
          <strong>This page has a generated version.</strong>
          <p className="hint">
            Editing tasks arrive in a later phase. A new brief re-generates a brand-new version of the page.
          </p>
        </div>
      ) : (
        <form onSubmit={generate} className="brief-form" aria-busy={busy}>
          <h2>Generate the first version</h2>
          <label>
            Locale
            <select value={locale} onChange={(e) => setLocale(e.target.value as 'ar' | 'fr' | 'en')}>
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
          <label>
            Tone
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Brief
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              placeholder="What is the business? Who is it for? What is the key message? (min. 10 characters)"
              required
            />
          </label>
          <label className="generate-images">
            <input type="checkbox" checked={generateImages} onChange={(e) => setGenerateImages(e.target.checked)} />
            Generate AI images for the page (best-effort — placeholders stay where generation is unavailable)
          </label>
          {brief.trim().length > 0 && brief.trim().length < BRIEF_MIN_LENGTH && (
            <p className="hint hint--warn" role="note">
              Brief looks short — add the business name, category and audience for a tailored page.
            </p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={busy || brief.trim().length < BRIEF_MIN_LENGTH}
            title={brief.trim().length < BRIEF_MIN_LENGTH ? `Write at least ${BRIEF_MIN_LENGTH} characters` : undefined}
          >
            {busy ? 'Preparing…' : 'Generate'}
          </button>
        </form>
      )}

      {job && (job.briefIncomplete || analysis?.has_enough_facts === false) && (
        <div className="incomplete" role="note">
          <strong>Brief incomplet.</strong>
          <span>
            The engine refuses to invent facts it is not given (no hallucination): it generated
            generic content with placeholders. Fill them in the editor below for a complete page.
          </span>
        </div>
      )}

      {job && completed && job.demoMode === 'stub' && (
        <div className="demo" role="note">
          <strong>Démonstration mode.</strong>
          <span>No LLM configured — the content comes from deterministic templates. Set a provider key and restart the AI Engine for tailored copy.</span>
        </div>
      )}

      {job && !completed && (
        <div className={`status status--${job.status.toLowerCase()}`}>
          <div className="status-row">
            <strong>{running ? STAGE_LABELS[lastEvent ?? ''] ?? 'Working…' : job.status}</strong>
            {running && (
              <button type="button" className="cancel" onClick={() => void cancel()} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
          {running && (
            <div className="progress" role="progressbar" aria-label="Generation progress">
              <span />
            </div>
          )}
          {failed && (
            <div className="failure">
              <p className="error">
                {job.errorMessage ?? 'The generator failed without a message.'}
              </p>
              <span className="code">{job.errorCode}</span>
            </div>
          )}
          {cancelled && <p className="hint">Generation cancelled. You can start a new one.</p>}
        </div>
      )}

      <style jsx>{`
        .generation { display: grid; gap: 20px; }
        .brief-form { display: grid; gap: 14px; max-width: 640px; }
        .brief-form h2 { margin: 0; }
        .brief-form label { display: grid; gap: 6px; font-size: 0.875rem; }
        .brief-form label.generate-images { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--color-text-muted); }
        .brief-form input, .brief-form select, .brief-form textarea { padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
        .brief-form textarea { resize: vertical; }
        .brief-form button { justify-self: start; padding: 10px 18px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-on-primary); cursor: pointer; }
        .brief-form button:disabled { opacity: 0.6; cursor: default; }
        .error { color: #b91c1c; font-size: 0.875rem; margin: 0; }
        .hint { color: var(--color-text-muted); font-size: 0.875rem; }
        .hint--warn { color: #92400e; }
        .incomplete { display: grid; gap: 4px; border: 1px solid #fcd34d; background: #fffbeb; border-radius: var(--radius-md); padding: 12px 16px; font-size: 0.875rem; color: #78350f; max-width: 640px; }
        .demo { display: grid; gap: 4px; border: 1px dashed var(--color-border); background: var(--color-surface-alt); border-radius: var(--radius-md); padding: 12px 16px; font-size: 0.875rem; color: var(--color-text-muted); max-width: 640px; }
        .status { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; background: var(--color-surface); max-width: 640px; }
        .status-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .cancel { border: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer; font-size: 0.875rem; }
        .progress { height: 6px; background: var(--color-surface-alt); border-radius: var(--radius-full); overflow: hidden; margin-top: 12px; }
        .progress span { display: block; height: 100%; width: 40%; background: var(--color-primary); animation: indeterminate 1.2s ease-in-out infinite; }
        @keyframes indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
        .failure { margin-top: 12px; display: grid; gap: 6px; }
        .code { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--color-text-muted); }
        .generated { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; background: var(--color-surface); max-width: 640px; }
        .status--failed { border-color: #fca5a5; background: #fef2f2; }
      `}</style>
    </section>
  );
}