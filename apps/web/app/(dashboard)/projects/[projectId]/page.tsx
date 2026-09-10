import { notFound } from 'next/navigation';
import { requireServerUser } from '@/lib/auth/server';
import { getProjectView, listPagesView } from '@/lib/data';
import { ProjectDetailView } from '@/components/project-detail-view';

export default async function ProjectPage({ params }: { params: { projectId: string } }) {
  const { owner } = await requireServerUser();
  let project;
  try {
    project = await getProjectView(owner, params.projectId);
  } catch {
    notFound();
  }
  const pages = await listPagesView(owner, params.projectId);
  return <ProjectDetailView project={project} pages={pages} />;
}