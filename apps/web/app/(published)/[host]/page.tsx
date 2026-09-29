import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublishedViewByHost } from '@/lib/public';
import { PublishedPageContent } from '@/components/published-page';
import { publishedPageJsonLd, publishedPageMetadata } from '@/lib/published-seo';

/**
 * Public published page (Phase 10 — J5).
 *
 * The route is server-only (data + metadata); the snapshot renders through the
 * deterministic public renderer wrapped in the app's only allowed client shell
 * (see components/published-page.tsx). No dashboard/editor module is reachable
 * from here — published pages ship zero dashboard/editor JS (§5.7). Indexable;
 * drafts and private project pages are noindex (dashboard layout). SEO gate:
 * canonical + description + robots + openGraph (og:image) + JSON-LD.
 */
export async function generateMetadata({ params }: { params: { host: string } }): Promise<Metadata> {
  const view = await getPublishedViewByHost(params.host);
  if (!view) return { robots: { index: false, follow: false }, title: 'Not found' };
  return publishedPageMetadata(view);
}

export default async function PublishedPage({ params }: { params: { host: string } }) {
  const view = await getPublishedViewByHost(params.host);
  if (!view) notFound();

  const jsonLd = publishedPageJsonLd(view);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublishedPageContent schema={view.content} />
    </>
  );
}