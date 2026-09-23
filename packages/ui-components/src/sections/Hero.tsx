/**
 * Hero section
 *
 * Variants: split | centered | full-bleed | minimal
 * a11y: single h1, first content section.
 * RTL: split variant places media at "end" by default → mirrors correctly.
 */

import React from 'react';
import { Container, Button } from '../primitives';
import type { HeroContent } from '../types';

export interface HeroSectionProps {
  content: HeroContent;
  layoutHint?: { mediaSide?: 'start' | 'end'; align?: 'start' | 'center' | 'end' };
  /** Registry variant (split | centered | full-bleed | minimal). */
  variant?: string;
}

const sectionPadding: React.CSSProperties = {
  paddingBlock: 'calc(var(--space-16) * var(--density, 1))',
};

export function Hero({ content, layoutHint, variant = 'split' }: HeroSectionProps) {
  const { title, subtitle, primaryCta, secondaryCta, media, badges = [] } = content;
  const mediaSide = layoutHint?.mediaSide ?? 'end';
  const align = layoutHint?.align ?? 'start';
  const isCentered = align === 'center' || variant === 'centered';
  const fullBleed = variant === 'full-bleed';
  const minimal = variant === 'minimal' || !media;
  const showMedia = !minimal && Boolean(media);

  const actions = (primaryCta || secondaryCta) ? (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-8)',
        flexWrap: 'wrap',
        justifyContent: isCentered ? 'center' : undefined,
      }}
    >
      {primaryCta ? <Button label={primaryCta.label} href={primaryCta.href} /> : null}
      {secondaryCta ? (
        <Button label={secondaryCta.label} href={secondaryCta.href} variant="secondary" />
      ) : null}
    </div>
  ) : null;

  const badgesBlock = badges.length > 0 ? (
    <ul
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        listStyle: 'none',
        margin: 'var(--space-8) 0 0',
        padding: 0,
        flexWrap: 'wrap',
        justifyContent: isCentered ? 'center' : undefined,
      }}
    >
      {badges.map((badge) => (
        <li
          key={badge}
          style={{
            backgroundColor: 'var(--color-primary-soft)',
            color: 'var(--color-primary)',
            borderRadius: '9999px',
            padding: 'var(--space-1) var(--space-3)',
            fontSize: 'var(--type-small)',
          }}
        >
          {badge}
        </li>
      ))}
    </ul>
  ) : null;

  const textBlock = (
    <>
      <h1
        style={{
          fontFamily: 'var(--font-family)',
          fontSize: 'var(--type-display)',
          lineHeight: 'var(--line-height)',
          color: 'var(--color-heading)',
          margin: 0,
          maxWidth: '24ch',
          textAlign: isCentered ? 'center' : undefined,
          marginInline: isCentered ? 'auto' : undefined,
        }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p
          style={{
            fontSize: 'var(--type-body-lg)',
            color: 'var(--color-text-muted)',
            marginTop: 'var(--space-4)',
            maxWidth: '55ch',
            textAlign: isCentered ? 'center' : undefined,
            marginInline: isCentered ? 'auto' : undefined,
          }}
        >
          {subtitle}
        </p>
      ) : null}
      {actions}
      {badgesBlock}
    </>
  );

  const mediaBlock = showMedia ? (
    <div style={{ flex: '1 1 40%', minWidth: 0 }}>
      <img
        src={media.assetRef}
        alt={media.alt}
        style={{
          width: '100%',
          height: 'auto',
          borderRadius: 'var(--radius)',
          objectFit: 'cover',
          aspectRatio: '3/2',
        }}
        loading="lazy"
      />
    </div>
  ) : null;

  const splitLayout = (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-12)',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexDirection: mediaSide === 'start' ? 'row-reverse' : 'row',
      }}
    >
      <div style={{ flex: '1 1 50%', minWidth: 280 }}>{textBlock}</div>
      {showMedia ? mediaBlock : null}
    </div>
  );

  const centeredLayout = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {textBlock}
      {showMedia ? <div style={{ width: '100%', marginTop: 'var(--space-12)' }}>{mediaBlock}</div> : null}
    </div>
  );

  const useSplit = Boolean(media && !isCentered && !fullBleed);

  if (fullBleed) {
    return (
      <section
        style={{
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-heading)',
        }}
      >
        {media && typeof media.assetRef === 'string' ? (
          <img
            src={media.assetRef}
            alt={media.alt}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : null}
        <div
          style={{
            position: 'relative',
            background:
              'linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0.18) 60%, rgba(0,0,0,0.25))',
            // Legibility over the raster: re-scope the semantic text tokens.
            '--color-heading': 'rgba(255,255,255,0.96)',
            '--color-text': 'rgba(255,255,255,0.92)',
            '--color-text-muted': 'rgba(255,255,255,0.82)',
          } as React.CSSProperties}
        >
          <Container>
            <div style={{ ...sectionPadding, paddingBottom: 'calc(var(--space-16) * var(--density, 1))', paddingTop: 'calc(var(--space-16) * var(--density, 1))' }}>
              <div style={{ maxWidth: '42ch', marginInline: '0' }}>
                {textBlock}
              </div>
            </div>
          </Container>
        </div>
      </section>
    );
  }

  return (
    <section style={{ backgroundColor: 'var(--color-bg)' }}>
      <Container>
        <div style={sectionPadding}>{useSplit ? splitLayout : centeredLayout}</div>
      </Container>
    </section>
  );
}