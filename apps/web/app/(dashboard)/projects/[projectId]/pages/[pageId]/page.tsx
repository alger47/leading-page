import { notFound } from 'next/navigation';
import { requireServerUser } from '@/lib/auth/server';
import { getPageDetailView } from '@/lib/data';
import { GenerationView } from '@/components/generation-view';
import { PagePreview } from '@/components/page-preview';

export default async function PageDetailPage({ params }: { params: { projectId: string; pageId: string } }) {
  const { owner } = await requireServerUser();

  let detail;
  try {
    detail = await getPageDetailView(owner, params.projectId, params.pageId);
  } catch {
    notFound();
  }

  const activeJob = detail.latestJob
    ? { id: detail.latestJob.id, status: detail.latestJob.status }
    : null;
  const hasVersion = detail.latestVersion !== null && detail.latestVersion.versionNumber >= 1;

  return (
    <section>
      <a href={`/projects/${params.projectId}`} className="back">← Back to project</a>
      <h1>{detail.page.title}</h1>
      <p className="meta">
        {detail.latestJob ? `Latest generation: ${detail.latestJob.status}` : 'No generation started yet.'}
      </p>

      <GenerationView
        projectId={params.projectId}
        pageId={params.pageId}
        hasVersion={hasVersion}
        activeJob={activeJob}
      />

      {hasVersion && detail.latestVersion && (
        <div className="preview-section">
          <h2>Preview</h2>
          <PagePreview schema={detail.latestVersion.content as Record<string, unknown>} />
        </div>
      )}
    </section>
  );
}