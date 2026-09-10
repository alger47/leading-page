/**
 * Contact section
 *
 * Variants: split
 * Honesty contract: contact details are user-provided (`[Phone]`/`[Email]`/
 * `[Address]`/`[Opening hours]` in stub), never invented.
 * a11y: <section> landmark; values are plain text slots (no fabricated hrefs).
 */

import { Container, SectionHeading } from '../primitives';
import type { ContactContent } from '../types';

export interface ContactSectionProps {
  id: string;
  content: ContactContent;
}

const ROWS: Array<{ key: keyof ContactContent; label: string }> = [
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'hours', label: 'Opening hours' },
];

export function Contact({ id, content }: ContactSectionProps) {
  const { eyebrow, title = 'Contact', subtitle } = content;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <Container>
        <div style={{ paddingBlock: 'var(--space-12)', display: 'grid', gap: 'var(--space-8)' }}>
          <SectionHeading eyebrow={eyebrow} title={title} description={subtitle} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            {ROWS.map((row) => {
              const value = content[row.key];
              if (!value) return null;
              return (
                <div
                  key={row.key}
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-6)',
                  }}
                >
                  <p
                    style={{
                      margin: '0 0 var(--space-2)',
                      fontSize: 'var(--type-small, 0.75rem)',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {row.label}
                  </p>
                  <p style={{ margin: 0, color: 'var(--color-heading)' }}>{value}</p>
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
