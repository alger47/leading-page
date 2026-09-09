/**
 * Renderer snapshot pin for AI-generated Page Schemas (§6.12)
 *
 * The SchemaBuilder (ai-engine) exports these fixtures deterministically
 * (see app/evaluation/export_fixtures.py + tests/test_fixture_exports.py).
 * This test pins schema → DOM: they must render through the SAME renderer,
 * never fall back, and remain byte-deterministic across renders.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Render } from '../src/Renderer';

import aiVetAr from '../../page-schema/examples/ai-vet-ar-001.json';
import aiSaasEn from '../../page-schema/examples/ai-saas-en-001.json';

const presets = ['warm-professional', 'cool-modern', 'bold-creative', 'minimal-clean'];
const fixtures = [
  { name: 'ai-vet-ar-001', schema: aiVetAr as unknown as Record<string, unknown> },
  { name: 'ai-saas-en-001', schema: aiSaasEn as unknown as Record<string, unknown> },
];

describe('AI-generated fixtures render (schema → DOM pin)', () => {
  for (const fixture of fixtures) {
    for (const preset of presets) {
      it(`${fixture.name} renders with theme=${preset}`, () => {
        const schema = {
          ...fixture.schema,
          theme: { ...(fixture.schema.theme as object), preset },
        };
        const { container } = render(<Render schema={schema} />);
        expect(container.querySelector('header')).toBeTruthy();
        expect(container.querySelector('footer')).toBeTruthy();
        expect(container.textContent).not.toContain('Unsupported section type');
        expect(container.textContent).not.toContain('could not be displayed');
      });
    }
  }

  it('ai-vet-ar-001 renders the hero headline once (single h1)', () => {
    const { container } = render(<Render schema={aiVetAr as unknown as Record<string, unknown>} />);
    const page = (aiVetAr as unknown as { page: { title: string } }).page;
    const h1s = container.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe(page.title);
  });

  it('ai-fixtures render byte-identically (determinism)', () => {
    const a = render(<Render schema={aiSaasEn as unknown as Record<string, unknown>} />);
    const b = render(<Render schema={aiSaasEn as unknown as Record<string, unknown>} />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
  });
});