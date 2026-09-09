/**
 * Footer section
 *
 * Variants: basic | extended
 * a11y: <footer> landmark (contentinfo).
 * RTL: links align with logical start; social uses inline flow.
 */

import React from 'react';
import { Container } from '../primitives';
import type { FooterContent } from '../types';

export interface FooterSectionProps {
  content: FooterContent;
}

const linkStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  textDecoration: 'none',
  fontSize: 'var(--type-body)',
};

export function Footer({ content }: FooterSectionProps) {
  const { brandName, links, social = [], legal, contact } = content;

  return (
    <footer style={{ backgroundColor: 'var(--color-surface-alt)', borderTop: '1px solid var(--color-border)' }}>
      <Container>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-8)',
            justifyContent: 'space-between',
            paddingBlock: 'var(--space-12)',
          }}
        >
          <div style={{ maxWidth: '16rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{brandName}</div>
            {legal ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--type-caption, 0.75rem)' }}>
                {legal}
              </p>
            ) : null}
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {links.map((link) => (
              <li key={`${link.label}-${link.href}`}>
                <a href={link.href} style={linkStyle}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          {social.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 'var(--space-4)' }}>
              {social.map((s) => (
                <li key={s.platform}>
                  <a href={s.url} style={linkStyle} rel="noopener noreferrer" target="_blank">
                    {s.platform}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          {contact ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {contact.phone ? <span style={linkStyle} dir="ltr">{contact.phone}</span> : null}
              {contact.email ? <a href={`mailto:${contact.email}`} style={linkStyle} dir="ltr">{contact.email}</a> : null}
              {contact.address ? <span style={linkStyle}>{contact.address}</span> : null}
            </div>
          ) : null}
        </div>
      </Container>
    </footer>
  );
}