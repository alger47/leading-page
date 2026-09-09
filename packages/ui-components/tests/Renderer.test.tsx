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
});
