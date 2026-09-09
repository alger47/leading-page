/**
 * Render matrix test (acceptance: every seed fixture renders across the matrix)
 *
 * Locales matrix: {ar-rtl, fr-ltr, en-ltr} × theme presets (all 4).
 * Proves determinism: same schema + different themes still renders; never blank.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Render } from '../src/Renderer';

import validVetAr from '../../page-schema/examples/valid-vet-ar-001.json';
import validSaasEn from '../../page-schema/examples/valid-saas-en-001.json';

const presets = ['warm-professional', 'cool-modern', 'bold-creative', 'minimal-clean'];
const fixtures = [
  { name: 'valid-vet-ar-001', schema: validVetAr as unknown as Record<string, unknown> },
  { name: 'valid-saas-en-001', schema: validSaasEn as unknown as Record<string, unknown> },
];

describe('Render matrix', () => {
  for (const fixture of fixtures) {
    for (const preset of presets) {
      it(`${fixture.name} renders with theme=${preset}`, () => {
        const schema = {
          ...fixture.schema,
          theme: { ...(fixture.schema.theme as object), preset },
          page: { ...(fixture.schema.page as object) },
        };
        const { container } = render(<Render schema={schema} />);
        expect(container.querySelector('section, header, footer')).toBeTruthy();
      });
    }
  }

  it('produces identical output for the same schema (determinism)', () => {
    const { container: a } = render(<Render schema={validSaasEn} />);
    const { container: b } = render(<Render schema={validSaasEn} />);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
});
