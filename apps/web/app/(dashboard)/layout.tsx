import { requireServerUser } from '@/lib/auth/server';
import { LogoutButton } from '@/components/logout-button';

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