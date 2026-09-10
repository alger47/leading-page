/**
 * Features section
 *
 * Variants: grid-3 | grid-4 | alternating | icon-row
 * a11y: <section> landmark (aria-labelledby), h2 title.
 */

import { Container, SectionHeading } from '../primitives';
import type { FeaturesContent } from '../types';

export interface FeaturesSectionProps {
  id: string;
  content: FeaturesContent;
  layoutHint?: { columns?: number };
}

function getColumns(columns?: number): number {
  return columns ? Math.min(Math.max(columns, 1), 4) : 3;
}

export function Features({ id, content, layoutHint }: FeaturesSectionProps) {
  const { eyebrow, title = 'Features', items } = content;
  const columns = getColumns(layoutHint?.columns);

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <Container>
        <div style={{ paddingBlock: 'var(--space-16)' }}>
          <SectionHeading eyebrow={eyebrow} title={title} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: layoutHint?.columns
                ? `repeat(${columns}, minmax(0, 1fr))`
                : 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
              gap: 'var(--space-6)',
            }}
          >
            {items.map((item, index) => (
              <article
                // Generated items have no stable id; titles can repeat, so key
                // by position to avoid duplicate React keys within one render.
                key={index}
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-6)',
                }}
              >
                <h3
                  style={{
                    fontSize: 'var(--type-h3)',
                    color: 'var(--color-heading)',
                    margin: '0 0 var(--space-2)',
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}