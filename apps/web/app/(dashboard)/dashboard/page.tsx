import { requireServerUser } from '@/lib/auth/server';
import { listProjectsView } from '@/lib/data';
import { DashboardView } from '@/components/dashboard-view';

export default async function DashboardPage() {
  const { owner } = await requireServerUser();
  const projects = await listProjectsView(owner);
  return <DashboardView projects={projects} />;
}