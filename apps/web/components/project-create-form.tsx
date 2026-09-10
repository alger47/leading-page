'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';

export function ProjectCreateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ project?: { id?: string }; error?: { message?: string } }>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (res.status !== 201 || !res.body.project?.id) {
        setError(res.body?.error?.message ?? 'Could not create the project.');
        return;
      }
      router.push(`/projects/${res.body.project.id}`);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="project-form" aria-busy={busy}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name (e.g. Le Bistro Les Lilas)" aria-label="Project name" required />
      <button type="submit" disabled={busy || name.trim() === ''}>{busy ? 'Creating…' : 'Create project'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      <style jsx>{`
        .project-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
        .project-form input { flex: 1; min-width: 260px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
        .project-form button { padding: 9px 14px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-on-primary); cursor: pointer; }
        .project-form button:disabled { opacity: 0.6; cursor: default; }
        .project-form .error { flex-basis: 100%; color: #b91c1c; font-size: 0.875rem; margin: 0; }
      `}</style>
    </form>
  );
}