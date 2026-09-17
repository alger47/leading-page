/**
 * Button primitive
 *
 * Consumes semantic component tokens only (var(--color-primary), etc.).
 * Uses logical CSS properties; safe for RTL.
 */

import React from 'react';
import { sanitizeHref } from '@landing-ai/page-schema';

export interface ButtonProps {
  label: string;
  href: string;
  variant?: 'primary' | 'secondary';
  className?: string;
}

const baseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: '2.75rem',
  paddingInline: '1.5rem',
  borderRadius: 'var(--radius)',
  fontWeight: 600,
  fontSize: 'var(--type-body)',
  lineHeight: 1,
  textDecoration: 'none',
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: 'background-color var(--duration-normal, 200ms), color var(--duration-normal, 200ms)',
};

const primaryStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
};

const secondaryStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-primary)',
  borderColor: 'var(--color-border)',
};

export function Button({ label, href, variant = 'primary', className }: ButtonProps) {
  return (
    <a
      href={sanitizeHref(href)}
      className={className}
      style={{ ...baseStyle, ...(variant === 'primary' ? primaryStyle : secondaryStyle) }}
    >
      {label}
    </a>
  );
}