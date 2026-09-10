import type { Metadata } from 'next';
import { requireServerUser } from '@/lib/auth/server';
import { LogoutButton } from '@/components/logout-button';

/** Drafts and private project pages MUST be noindex (§5.7). */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireServerUser();
  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="/dashboard" className="brand">
          Landing AI Studio
        </a>
        <nav aria-label="Primary">
          <span className="user-name">{user.name || user.email}</span>
          <LogoutButton />
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}