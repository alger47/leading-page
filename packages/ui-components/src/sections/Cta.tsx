/**
 * CTA section
 *
 * Variants: banner | boxed | band
 * a11y: <section> landmark; prominent CTA button.
 */

import { Container, Button } from '../primitives';
import type { CtaContent } from '../types';

export interface CtaSectionProps {
  id: string;
  content: CtaContent;
}

export function Cta({ id, content }: CtaSectionProps) {
  const { title, subtitle, primaryCta, secondaryCta } = content;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      style={{ backgroundColor: 'var(--color-primary)' }}
    >
      <Container>
        <div style={{ paddingBlock: 'var(--space-12)', textAlign: 'center' }}>
          <h2
            id={`${id}-heading`}
            style={{
              fontFamily: 'var(--font-family)',
              fontSize: 'var(--type-h2)',
              color: 'var(--color-on-primary)',
              margin: 0,
            }}
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              style={{
                color: 'var(--color-on-primary)',
                opacity: 0.9,
                maxWidth: '46ch',
                margin: 'var(--space-4) auto',
              }}
            >
              {subtitle}
            </p>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              justifyContent: 'center',
              marginTop: 'var(--space-6)',
              flexWrap: 'wrap',
            }}
          >
            {primaryCta ? <Button label={primaryCta.label} href={primaryCta.href} /> : null}
            {secondaryCta ? (
              <Button label={secondaryCta.label} href={secondaryCta.href} variant="secondary" />
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}