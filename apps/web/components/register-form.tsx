'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ error?: { message?: string } }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name: name || null, password }),
      });
      if (res.status !== 201) {
        setError(res.body?.error?.message ?? 'Could not create the account.');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} aria-busy={busy}>
      <h1>Create an account</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <label>
        Display name (optional)
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      <p className="form-muted">
        Already have an account? <a href="/login">Log in</a>
      </p>
      <style jsx>{`
        .auth-form { max-width: 380px; margin: 48px auto; padding: 0 16px; display: grid; gap: 12px; }
        .auth-form h1 { margin: 0 0 8px; }
        .auth-form label { display: grid; gap: 4px; font-size: 0.875rem; }
        .auth-form input { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
        .auth-form button { padding: 10px 12px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-on-primary); cursor: pointer; }
        .auth-form button:disabled { opacity: 0.6; cursor: default; }
        .auth-form .form-error { color: #b91c1c; font-size: 0.875rem; margin: 0; }
        .auth-form .form-muted { font-size: 0.875rem; margin: 0; }
      `}</style>
    </form>
  );
}