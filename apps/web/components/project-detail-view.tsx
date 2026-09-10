'use client';

import type { PageView } from '@/lib/data';
import { PageCreateForm } from '@/components/page-create-form';

export interface ProjectSummary {
  id: string;
  name: string;
  defaultLocale: string | null;
  tone: string | null;
}

export function ProjectDetailView({ project, pages }: { project: ProjectSummary; pages: PageView[] }) {
  return (
    <section>
      <a href="/dashboard" className="back">← All projects</a>
      <h1>{project.name}</h1>
      <p className="meta">
        {project.defaultLocale ? `Default locale: ${project.defaultLocale}` : 'Locale chosen per page'}
        {project.tone ? ` · Tone: ${project.tone}` : ''}
      </p>

      {pages.length === 0 ? (
        <div className="empty">
          <h2>No pages yet</h2>
          <p>Add a page, then generate its first version from a brief.</p>
        </div>
      ) : (
        <ul className="page-list">
          {pages.map((pg) => (
            <li key={pg.id}>
              <a href={`/projects/${project.id}/pages/${pg.id}`} className="page-row">
                <span className="page-title">{pg.title}</span>
                <span className="page-meta">
                  {pg.locale || 'any locale'} · {pg.status} · {pg.versionCount} {pg.versionCount === 1 ? 'version' : 'versions'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">New page</h2>
      <PageCreateForm projectId={project.id} />

      <style jsx>{`
        .back { font-size: 0.875rem; text-decoration: none; }
        .meta { color: var(--color-text-muted); font-size: 0.875rem; }
        .page-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .page-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); text-decoration: none; }
        .page-title { color: var(--color-heading); font-weight: 600; }
        .page-meta { color: var(--color-text-muted); font-size: 0.875rem; }
        .empty { padding: 32px 24px; text-align: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); }
        .section-title { margin-top: 32px; }
      `}</style>
    </section>
  );
}