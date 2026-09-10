import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublishedViewByHost } from '@/lib/public';
import { PublishedPageContent } from '@/components/published-page';

/**
 * Public published page (Phase 10 — J5).
 *
 * The route is server-only (data + metadata); the snapshot renders through the
 * deterministic public renderer wrapped in the app's only allowed client shell
 * (see components/published-page.tsx). No dashboard/editor module is reachable
 * from here — published pages ship zero dashboard/editor JS (§5.7). Indexable;
 * drafts and private project pages are noindex (dashboard layout).
 */
export async function generateMetadata({ params }: { params: { host: string } }): Promise<Metadata> {
  const view = await getPublishedViewByHost(params.host);
  if (!view) return { robots: { index: false, follow: false }, title: 'Not found' };
  return {
    title: view.title,
    robots: { index: true, follow: true },
  };
}

export default async function PublishedPage({ params }: { params: { host: string } }) {
  const view = await getPublishedViewByHost(params.host);
  if (!view) notFound();

  return <PublishedPageContent schema={view.content} />;
}