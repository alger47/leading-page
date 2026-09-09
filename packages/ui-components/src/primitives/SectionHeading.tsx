/**
 * SectionHeading primitive
 *
 * Consistent eyebrow/title/description block across sections.
 * Heading order must respect the a11y contract (landmark + heading level).
 */

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function SectionHeading({ eyebrow, title, description }: SectionHeadingProps) {
  return (
    <header style={{ marginBottom: 'var(--space-8)', maxWidth: '48rem' }}>
      {eyebrow ? (
        <p
          style={{
            fontSize: 'var(--type-caption, 0.75rem)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-primary)',
            marginInlineEnd: 'auto',
          }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        style={{
          fontFamily: 'var(--font-family)',
          fontSize: 'var(--type-h2)',
          lineHeight: 'var(--line-height)',
          color: 'var(--color-heading)',
          margin: 'var(--space-2) 0 0',
        }}
      >
        {title}
      </h2>
      {description ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}>
          {description}
        </p>
      ) : null}
    </header>
  );
}