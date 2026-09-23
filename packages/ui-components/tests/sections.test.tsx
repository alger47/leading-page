/**
 * Section-level component tests
 *
 * Every registry component × variant fixture must render.
 * A11y contract checks (headings, landmarks, labels) run here.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header, Hero, Features, Cta, Footer } from '../src/sections';

describe('Header', () => {
  it('renders brand + nav + CTA (with-cta variant)', () => {
    render(
      <Header
        content={{
          brandName: 'عيادة الأصدقاء البيطرية',
          nav: [{ label: 'الرئيسية', href: '#hero-1' }],
          navCta: { label: 'احجز موعد', href: '#cta-1' },
        }}
      />
    );
    expect(screen.getByText('عيادة الأصدقاء البيطرية')).toBeTruthy();
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getByText('احجز موعد')).toBeTruthy();
  });

  it('renders without nav when not provided (basic variant)', () => {
    render(<Header content={{ brandName: 'Brand' }} />);
    expect(screen.getByText('Brand')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('Hero', () => {
  it('renders h1, subtitle, primary CTA (centered)', () => {
    render(
      <Hero
        content={{
          title: 'Track Every Dollar Effortlessly',
          subtitle: 'Simplest way.',
          primaryCta: { label: 'Start Free', href: '#cta-1' },
        }}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByText('Start Free')).toBeTruthy();
  });

  it('renders both CTAs when present', () => {
    render(
      <Hero
        content={{
          title: 'A Great Title Here',
          primaryCta: { label: 'Primary', href: '#a' },
          secondaryCta: { label: 'Secondary', href: '#b' },
        }}
      />
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders badges when provided', () => {
    render(
      <Hero
        content={{
          title: 'A Great Title Here',
          primaryCta: { label: 'Go', href: '#a' },
          badges: ['Trust badge'],
        }}
      />
    );
    expect(screen.getByText('Trust badge')).toBeTruthy();
  });

  it('renders the media image for split/full-bleed variants', () => {
    render(
      <Hero
        variant="full-bleed"
        content={{
          title: 'Full Bleed Hero',
          primaryCta: { label: 'Go', href: '#a' },
          media: { assetRef: '/assets/asset/asset%3Ahero-bg', alt: 'herobg' },
        }}
      />
    );
    expect(screen.getByAltText('herobg')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Full Bleed Hero');
  });

  it('does not render media for the minimal variant', () => {
    render(
      <Hero
        variant="minimal"
        content={{
          title: 'Minimal Hero',
          primaryCta: { label: 'Go', href: '#a' },
          media: { assetRef: '/assets/asset/asset%3Ahero-bg', alt: 'herobg' },
        }}
      />
    );
    expect(screen.queryByAltText('herobg')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Minimal Hero');
  });
});

describe('Features', () => {
  it('renders items with heading level 2 for section title', () => {
    render(
      <Features
        id="features-1"
        content={{
          eyebrow: 'Services',
          title: 'What We Offer',
          items: [
            { title: 'Checks', description: 'Full checkups' },
            { title: 'Vaccines', description: 'All vaccines' },
          ],
        }}
      />
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('What We Offer');
    expect(screen.getByText('Checks')).toBeTruthy();
    expect(screen.getByText('Vaccines')).toBeTruthy();
  });
});

describe('Cta', () => {
  it('renders title and CTA button', () => {
    render(
      <Cta
        id="cta-1"
        content={{
          title: 'Book now',
          primaryCta: { label: 'Book', href: '#contact' },
        }}
      />
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Book now');
    expect(screen.getByText('Book')).toBeTruthy();
  });
});

describe('Footer', () => {
  it('renders brand, links, social, legal, contact (extended)', () => {
    render(
      <Footer
        content={{
          brandName: 'Clinic',
          links: [{ label: 'Home', href: '#hero-1' }],
          social: [{ platform: 'facebook', url: 'https://facebook.com/x' }],
          legal: '© 2026 Clinic',
          contact: { phone: '+213555', email: 'c@clinic.example' },
        }}
      />
    );
    expect(screen.getByText('Clinic')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    expect(screen.getByText('facebook')).toBeTruthy();
    expect(screen.getByText('© 2026 Clinic')).toBeTruthy();
  });

  it('renders only brand + links (basic)', () => {
    render(<Footer content={{ brandName: 'Brand', links: [{ label: 'Home', href: '#' }] }} />);
    expect(screen.queryByText('facebook')).toBeNull();
  });
});