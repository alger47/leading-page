/**
 * Renderer tests
 *
 * Acceptance: every seed fixture renders across the matrix;
 * unknown type → safe fallback (E-RENDER-001); sections render deterministically.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Render } from '../src/Renderer';

import validVetAr from '../../page-schema/examples/valid-vet-ar-001.json';
import validSaasEn from '../../page-schema/examples/valid-saas-en-001.json';

describe('Renderer', () => {
  it('renders the vet Arabic fixture (RTL, warm-professional)', () => {
    render(<Render schema={validVetAr} />);
    expect(screen.getAllByText('عيادة الأصدقاء البيطرية').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'رعاية بيطرية تثق بها عائلتك'
    );
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
    // single h1
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders the SaaS English fixture (LTR, cool-modern)', () => {
    render(<Render schema={validSaasEn} />);
    expect(screen.getAllByText('ExpenseFlow').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Track Every Dollar Effortlessly'
    );
    expect(screen.getAllByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('sets dir=rtl for Arabic locale and dir=ltr for English', () => {
    const { container: ar } = render(<Render schema={validVetAr} />);
    expect(ar.querySelector('[dir="rtl"]')).toBeTruthy();

    const { container: en } = render(<Render schema={validSaasEn} />);
    expect(en.querySelector('[dir="ltr"]')).toBeTruthy();
  });

  it('renders unknown section types with a safe fallback (E-RENDER-001)', () => {
    const onLog = vi.fn();
    const badSchema = {
      ...validSaasEn,
      sections: [
        { id: 'x-1', type: 'totally-unknown', variant: 'x', content: {} },
      ],
    };
    render(<Render schema={badSchema} onLog={onLog} />);
    expect(screen.getByText(/Unsupported section type/i)).toBeTruthy();
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'E-RENDER-001' })
    );
  });

  it('does not render a blank page even if any section is missing', () => {
    const { container } = render(<Render schema={{ page: { locale: 'en', direction: 'ltr' }, theme: { preset: 'cool-modern' }, sections: [] }} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the Phase 14 sections (testimonials, pricing, faq, gallery, contact)', () => {
    const schema = {
      page: { title: 'Phase 14', locale: 'en', direction: 'ltr' },
      theme: { preset: 'cool-modern' },
      sections: [
        { id: 'testimonials-1', type: 'testimonials', variant: 'grid-3', content: { eyebrow: 'Social proof', title: 'What customers say', items: [{ quote: '[Customer quote]', name: '[Customer name]', role: '[Role / company]' }] }, layoutHint: { columns: 3 } },
        { id: 'pricing-1', type: 'pricing', variant: 'tiers-3', content: { eyebrow: 'Pricing', title: 'Simple, honest pricing', tiers: [{ name: '[Plan name]', price: '[Price]', features: ['[Benefit or feature]'], cta: { label: '[Plan CTA]', href: '#cta-1' } }] }, layoutHint: { columns: 3 } },
        { id: 'faq-1', type: 'faq', variant: 'accordion', content: { eyebrow: 'FAQ', title: 'Frequently asked questions', items: [{ question: '[Question]', answer: '[Answer]' }] } },
        { id: 'gallery-1', type: 'gallery', variant: 'grid-3', content: { eyebrow: 'Gallery', title: 'A look inside', items: [{ image: { assetRef: 'asset:gallery-0', alt: 'our business' }, caption: '[Caption]' }] }, layoutHint: { columns: 3 } },
        { id: 'contact-1', type: 'contact', variant: 'split', content: { eyebrow: 'Contact', title: 'Get in touch', subtitle: 'Tell us what you need.', phone: '[Phone]', email: '[Email]' } },
      ],
    };
    const { container } = render(<Render schema={schema} />);
    expect(screen.getByText('What customers say')).toBeTruthy();
    expect(screen.getByText((t) => t.includes('Customer quote'))).toBeTruthy();
    expect(screen.getByText('Simple, honest pricing')).toBeTruthy();
    expect(screen.getByText('[Price]')).toBeTruthy();
    expect(screen.getByText('Frequently asked questions')).toBeTruthy();
    expect(screen.getByText('A look inside')).toBeTruthy();
    expect(screen.getByText('Get in touch')).toBeTruthy();
    // gallery alt text (a11y) is rendered on the img
    expect(container.querySelector('img[alt="our business"]')).toBeTruthy();
    // native accordion markup
    expect(container.querySelector('summary')?.textContent).toBe('[Question]');
  });
});
