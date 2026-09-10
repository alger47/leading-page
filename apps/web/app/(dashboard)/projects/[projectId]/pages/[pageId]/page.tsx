import { notFound } from 'next/navigation';
import { requireServerUser } from '@/lib/auth/server';
import { getPageDetailView, getPublishView } from '@/lib/data';
import { GenerationView } from '@/components/generation-view';
import { PageEditor } from '@/components/editor/page-editor';
import { VersionsView } from '@/components/versions-view';
import { PublishView } from '@/components/publish-view';

export default async function PageDetailPage({ params }: { params: { projectId: string; pageId: string } }) {
  const { owner } = await requireServerUser();

  let detail;
  try {
    detail = await getPageDetailView(owner, params.projectId, params.pageId);
  } catch {
    notFound();
  }

  const activeJob = detail.latestJob
    ? { id: detail.latestJob.id, status: detail.latestJob.status, briefIncomplete: detail.latestJob.briefAnalysis?.has_enough_facts === false }
    : null;
  const hasVersion = detail.latestVersion !== null && detail.latestVersion.versionNumber >= 1;
  const publishView = await getPublishView(owner, params.projectId, params.pageId);

  return (
    <section>
      <a href={`/projects/${params.projectId}`} className="back">← Back to project</a>
      <h1>{detail.page.title}</h1>
      <p className="meta">
        {detail.latestJob ? `Latest generation: ${detail.latestJob.status}` : 'No generation started yet.'}
        {detail.latestJob && detail.latestJob.briefAnalysis?.has_enough_facts === false && (
          <span className="meta-warn">⚠️ Brief incomplet — generic content expected</span>
        )}
      </p>

      <GenerationView
        projectId={params.projectId}
        pageId={params.pageId}
        hasVersion={hasVersion}
        activeJob={activeJob}
      />

      {hasVersion && detail.latestVersion && (
        <div className="editor-section">
          <h2>Editor</h2>
          <PageEditor
            key={`v${detail.latestVersion.versionNumber}`}
            projectId={params.projectId}
            pageId={params.pageId}
            version={detail.latestVersion}
          />
        </div>
      )}

      {hasVersion && detail.latestVersion && (
        <div className="editor-section">
          <h2>Versions</h2>
          <VersionsView pageId={params.pageId} currentVersion={detail.latestVersion.versionNumber} />
        </div>
      )}

      {hasVersion && detail.latestVersion && (
        <div className="editor-section">
          <h2>Publishing</h2>
          <PublishView pageId={params.pageId} initial={publishView} />
        </div>
      )}
    </section>
  );
}