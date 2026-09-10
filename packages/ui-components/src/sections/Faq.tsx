/**
 * FAQ section
 *
 * Variants: accordion
 * Honesty contract: questions/answers are user-provided (`[Question]`/
 * `[Answer]` in stub), never invented.
 * a11y: native <details> accordion, <section> landmark.
 */

import { Container, SectionHeading } from '../primitives';
import type { FaqContent } from '../types';

export interface FaqSectionProps {
  id: string;
  content: FaqContent;
}

export function Faq({ id, content }: FaqSectionProps) {
  const { eyebrow, title = 'FAQ', items } = content;

  return (
    <section id={id} aria-labelledby={`${id}-heading`} style={{ backgroundColor: 'var(--color-surface)' }}>
      <Container>
        <div style={{ paddingBlock: 'var(--space-16)', maxWidth: '48rem' }}>
          <SectionHeading eyebrow={eyebrow} title={title} />

          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {items.map((item, index) => (
              <details
                key={index}
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-4)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontWeight: 600,
                    color: 'var(--color-heading)',
                    fontSize: 'var(--type-body)',
                  }}
                >
                  {item.question}
                </summary>
                <p style={{ margin: 'var(--space-3) 0 0', color: 'var(--color-text-muted)' }}>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}