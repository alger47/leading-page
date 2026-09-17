/**
 * Header section
 *
 * Variants: basic | with-cta
 * a11y: <header> landmark; primary CTA visible; mobile-friendly nav.
 * RTL: nav uses inline-start flow direction (dir handled by ThemeProvider).
 */

import React from 'react';
import { Container, Button } from '../primitives';
import type { HeaderContent } from '../types';
import { sanitizeHref } from '@landing-ai/page-schema';

export interface HeaderSectionProps {
  id: string;
  content: HeaderContent;
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-6)',
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const headerInnerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '4rem',
};

const brandStyle: React.CSSProperties = {
  fontSize: 'var(--type-h3)',
  fontWeight: 700,
  color: 'var(--color-heading)',
  textDecoration: 'none',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--color-text)',
  textDecoration: 'none',
  fontSize: 'var(--type-body)',
};

export function Header({ content }: HeaderSectionProps) {
  const { brandName, nav = [], navCta } = content;

  return (
    <header style={{ backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
      <Container>
        <div style={headerInnerStyle}>
          <a href="#top" style={brandStyle}>
            {brandName}
          </a>
          {nav.length > 0 ? (
            <nav aria-label={navCta ? 'Primary navigation' : 'Navigation'}>
              <ul style={navStyle}>
                {nav.map((item) => (
                  <li key={item.href}>
                    <a href={sanitizeHref(item.href)} style={linkStyle}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {navCta ? (
            <Button label={navCta.label} href={navCta.href} />
          ) : null}
        </div>
      </Container>
    </header>
  );
}