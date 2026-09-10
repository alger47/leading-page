/**
 * Pricing section
 *
 * Variants: tiers-3
 * Honesty contract: prices come from the user (`[Price]` in stub), never
 * invented. "no invented prices" is part of the golden quality criteria.
 * a11y: <section> landmark; highlighted tier carries a label for contrast.
 */

import { Container, SectionHeading, Button } from '../primitives';
import type { PricingContent } from '../types';

export interface PricingSectionProps {
  id: string;
  content: PricingContent;
  layoutHint?: { columns?: number };
}

export function Pricing({ id, content, layoutHint }: PricingSectionProps) {
  const { eyebrow, title = 'Pricing', subtitle, tiers } = content;
  const columns = layoutHint?.columns ? Math.min(Math.max(layoutHint.columns, 1), 4) : 3;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <Container>
        <div style={{ paddingBlock: 'var(--space-16)' }}>
          <SectionHeading eyebrow={eyebrow} title={title} description={subtitle} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: layoutHint?.columns
                ? `repeat(${columns}, minmax(0, 1fr))`
                : 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
              gap: 'var(--space-6)',
              alignItems: 'stretch',
            }}
          >
            {tiers.map((tier, index) => (
              <article
                key={index}
                style={{
                  display: 'grid',
                  gap: 'var(--space-4)',
                  alignContent: 'start',
                  padding: 'var(--space-6)',
                  borderRadius: 'var(--radius)',
                  border: tier.highlight ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  backgroundColor: tier.highlight ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                }}
              >
                <h3 style={{ margin: 0, fontSize: 'var(--type-h3)', color: 'var(--color-heading)' }}>{tier.name}</h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: 'var(--type-h2)',
                    fontWeight: 700,
                    color: 'var(--color-heading)',
                  }}
                >
                  {tier.price}
                </p>
                <ul style={{ margin: 0, paddingInlineStart: 'var(--space-6)', color: 'var(--color-text-muted)', display: 'grid', gap: 'var(--space-2)' }}>
                  {tier.features.map((feature, i) => (
                    <li key={i}>{feature}</li>
                  ))}
                </ul>
                {tier.cta ? (
                  <div style={{ marginTop: 'auto', paddingTop: 'var(--space-4)' }}>
                    <Button label={tier.cta.label} href={tier.cta.href} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
