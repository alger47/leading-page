/**
 * Gallery section
 *
 * Variants: grid-3
 * Honesty contract: images are `asset:` refs the user replaces; captions are
 * `[Caption]` placeholders in stub mode (never invented).
 * a11y: <section> landmark; every image carries alt text.
 */

import { Container, SectionHeading } from '../primitives';
import type { GalleryContent } from '../types';

export interface GallerySectionProps {
  id: string;
  content: GalleryContent;
  layoutHint?: { columns?: number };
}

export function Gallery({ id, content, layoutHint }: GallerySectionProps) {
  const { eyebrow, title = 'Gallery', items } = content;
  const columns = layoutHint?.columns ? Math.min(Math.max(layoutHint.columns, 1), 4) : 3;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <Container>
        <div style={{ paddingBlock: 'var(--space-16)' }}>
          <SectionHeading eyebrow={eyebrow} title={title} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: layoutHint?.columns
                ? `repeat(${columns}, minmax(0, 1fr))`
                : 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
              gap: 'var(--space-6)',
            }}
          >
            {items.map((item, index) => (
              <figure
                key={index}
                style={{
                  margin: 0,
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                }}
              >
                {item.image ? (
                  // alt text is required (a11y contract); the assetRef slot is
                  // user data resolved by the assets pipeline at render time.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image.assetRef}
                    alt={item.image.alt}
                    loading="lazy"
                    style={{ width: '100%', height: '200px', objectFit: 'cover', display: 'block' }}
                  />
                ) : null}
                {item.caption ? (
                  <figcaption style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--type-small)' }}>
                    {item.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
