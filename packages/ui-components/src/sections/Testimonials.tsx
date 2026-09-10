/**
 * Testimonials section
 *
 * Variants: grid-3 (single implemented variant in Phase 14)
 * Honesty contract: NEVER invented. The stub emits `[Customer quote]` /
 * `[Customer name]` / `[Role / company]` placeholder tokens; the UI renders
 * them as-is so the honest state survives until the user fills them in.
 * a11y: <section> landmark, blockquote + figcaption per item.
 */

import { Container, SectionHeading } from '../primitives';
import type { TestimonialsContent } from '../types';

export interface TestimonialsSectionProps {
  id: string;
  content: TestimonialsContent;
  layoutHint?: { columns?: number };
}

export function Testimonials({ id, content, layoutHint }: TestimonialsSectionProps) {
  const { eyebrow, title = 'Testimonials', items } = content;
  const columns = layoutHint?.columns ? Math.min(Math.max(layoutHint.columns, 1), 4) : 3;

  return (
    <section id={id} aria-labelledby={`${id}-heading`} style={{ backgroundColor: 'var(--color-surface)' }}>
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
              <figure
                key={index}
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-6)',
                  margin: 0,
                  display: 'grid',
                  gap: 'var(--space-4)',
                }}
              >
                <blockquote style={{ margin: 0, color: 'var(--color-text)' }}>“{item.quote}”</blockquote>
                <figcaption style={{ color: 'var(--color-text-muted)', fontSize: 'var(--type-small)' }}>
                  {item.name ? <strong style={{ color: 'var(--color-heading)' }}>{item.name}</strong> : null}
                  {item.role ? <span> — {item.role}</span> : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}