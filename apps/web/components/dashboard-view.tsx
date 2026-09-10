'use client';

import type { ProjectView } from '@/lib/data';
import { ProjectCreateForm } from '@/components/project-create-form';

function Empty() {
  return (
    <div className="empty">
      <h2>No projects yet</h2>
      <p>
        Create your first project, add a page, and write a brief. The generator
        produces a multi-section landing page you can preview and iterate on.
      </p>
      <style jsx>{`
        .empty { padding: 40px 24px; text-align: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); }
      `}</style>
    </div>
  );
}

export function DashboardView({ projects }: { projects: ProjectView[] }) {
  if (projects.length === 0) {
    return (
      <section>
        <h1>Your projects</h1>
        <Empty />
        <h2 className="section-title">Create a project</h2>
        <ProjectCreateForm />
      </section>
    );
  }

  return (
    <section>
      <h1>Your projects</h1>
      <ul className="project-list">
        {projects.map((p) => (
          <li key={p.id}>
            <a href={`/projects/${p.id}`} className="project-card">
              <strong>{p.name}</strong>
              <span>{p.pageCount} {p.pageCount === 1 ? 'page' : 'pages'}</span>
            </a>
          </li>
        ))}
      </ul>
      <h2 className="section-title">New project</h2>
      <ProjectCreateForm />
      <style jsx>{`
        .project-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .project-card { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); text-decoration: none; }
        .project-card span { color: var(--color-text-muted); font-size: 0.875rem; }
        .section-title { margin-top: 32px; }
      `}</style>
    </section>
  );
}