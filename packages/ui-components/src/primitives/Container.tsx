/**
 * Container primitive
 *
 * Centers content with a max width using logical properties.
 */

import React from 'react';

export interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Container({ children, className, style }: ContainerProps) {
  return (
    <div
      className={className}
      style={{
        width: '100%',
        maxWidth: 'var(--container, 72rem)',
        marginInline: 'auto',
        paddingInline: 'var(--space-4)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}