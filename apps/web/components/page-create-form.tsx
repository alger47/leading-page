'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';

export function PageCreateForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ page?: { id?: string }; error?: { message?: string } }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/pages`,
        { method: 'POST', body: JSON.stringify({ title }) },
      );
      if (res.status !== 201 || !res.body.page?.id) {
        setError(res.body?.error?.message ?? 'Could not create the page.');
        return;
      }
      router.push(`/projects/${projectId}/pages/${res.body.page.id}`);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="page-form" aria-busy={busy}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title (e.g. Bistro homepage)" aria-label="Page title" required />
      <button type="submit" disabled={busy || title.trim() === ''}>{busy ? 'Creating…' : 'Create page'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      <style jsx>{`
        .page-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
        .page-form input { flex: 1; min-width: 260px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
        .page-form button { padding: 9px 14px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-on-primary); cursor: pointer; }
        .page-form button:disabled { opacity: 0.6; cursor: default; }
        .page-form .error { flex-basis: 100%; color: #b91c1c; font-size: 0.875rem; margin: 0; }
      `}</style>
    </form>
  );
}