'use client';

import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client-api';

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" onClick={logout} className="logout">
      Log out
      <style jsx>{`
        .logout { border: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer; font-size: 0.875rem; }
      `}</style>
    </button>
  );
}