/**
 * L2 Semantic Validation Tests
 * 
 * Tests for semantic validation of Page Schema documents.
 * Per master prompt §8.2:
 * - SEM-001: Exactly one hero; hero is the first content section
 * - SEM-002: hero.title non-empty, 2-14 words
 * - SEM-003: >= 1 actionable CTA within the first two content sections
 * - SEM-004: Page ends with a footer
 */

import { describe, it, expect } from 'vitest';
import { validateSemantic } from '../src/validators/semantic';

// Valid fixtures
import validVetAr from '../examples/valid-vet-ar-001.json';
import validSaasEn from '../examples/valid-saas-en-001.json';

// AI-generated fixtures (Phase 5 — SchemaBuilder exports, engine drift-guarded).
// These are RAW engine snapshots: the stub intentionally keeps `[Placeholder]`
// slots (engine = draft producer); the web publish path fills them before the
// L2 gate, so the raw snapshots must FAIL SEM-006 but still pass SEM-001..005.
import aiVetAr from '../examples/ai-vet-ar-001.json';
import aiSaasEn from '../examples/ai-saas-en-001.json';

// Invalid fixtures
import invalidNoHero from '../examples/invalid-no-hero.json';

describe('L2 Semantic Validation', () => {
  describe('Valid fixtures', () => {
    it('should validate valid-vet-ar-001.json with no errors', () => {
      const result = validateSemantic(validVetAr);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid-saas-en-001.json with no errors', () => {
      const result = validateSemantic(validSaasEn);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('ai snapshots pass SEM-001..005 but carry raw placeholders (SEM-006 not yet filled)', () => {
      for (const doc of [aiVetAr, aiSaasEn]) {
        const result = validateSemantic(doc);
        expect(result.errors.some((e) => e.ruleId === 'SEM-006')).toBe(true);
        const nonPlaceholder = result.errors.filter((e) => e.ruleId !== 'SEM-006');
        expect(nonPlaceholder).toHaveLength(0);
      }
    });
  });

  describe('SEM-001: Hero section', () => {
    it('should fail when no hero section exists', () => {
      const result = validateSemantic(invalidNoHero);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'SEM-001')).toBe(true);
    });

    it('should fail when hero is not the first content section', () => {
      const doc = {
        ...validVetAr,
        sections: [
          validVetAr.sections[0], // header
          validVetAr.sections[2], // features (not hero)
          validVetAr.sections[1], // hero (wrong position)
          validVetAr.sections[3], // cta
          validVetAr.sections[4], // footer
        ],
      };
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-001')).toBe(true);
    });
  });

  describe('SEM-002: Hero title', () => {
    it('should fail when hero title is empty', () => {
      const doc = {
        ...validVetAr,
        sections: validVetAr.sections.map((s: any) =>
          s.type === 'hero'
            ? { ...s, content: { ...s.content, title: '' } }
            : s
        ),
      };
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-002')).toBe(true);
    });

    it('should fail when hero title has less than 2 words', () => {
      const doc = {
        ...validVetAr,
        sections: validVetAr.sections.map((s: any) =>
          s.type === 'hero'
            ? { ...s, content: { ...s.content, title: 'Hello' } }
            : s
        ),
      };
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-002')).toBe(true);
    });

    it('should fail when hero title has more than 14 words', () => {
      const doc = {
        ...validVetAr,
        sections: validVetAr.sections.map((s: any) =>
          s.type === 'hero'
            ? {
                ...s,
                content: {
                  ...s.content,
                  title: 'This is a very long hero title that has way more than fourteen words in it',
                },
              }
            : s
        ),
      };
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-002')).toBe(true);
    });
  });

  describe('SEM-003: CTA in first two sections', () => {
    it('should fail when no CTA in first two content sections', () => {
      const doc = {
        ...validVetAr,
        sections: [
          validVetAr.sections[0], // header
          {
            ...validVetAr.sections[2], // features (no CTA)
          },
          {
            ...validVetAr.sections[2], // features (no CTA)
          },
          validVetAr.sections[3], // cta
          validVetAr.sections[4], // footer
        ],
      };
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-003')).toBe(true);
    });
  });

  describe('SEM-004: Footer at end', () => {
    it('should fail when page does not end with footer', () => {
      const doc = {
        ...validVetAr,
        sections: [
          validVetAr.sections[0], // header
          validVetAr.sections[1], // hero
          validVetAr.sections[2], // features
          validVetAr.sections[3], // cta (not footer)
        ],
      };
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-004')).toBe(true);
    });
  });

  describe('SEM-005: internal anchors resolve (review و)', () => {
    it('should fail when a #anchor targets a missing section id', () => {
      const doc = structuredClone(validVetAr) as typeof validVetAr & {
        sections: Array<{ type: string; content: { primaryCta?: { href?: string }; links?: Array<{ href: string }> } }>;
      };
      const cta = doc.sections.find((s: { type: string }) => s.type === 'cta')!;
      cta.content.primaryCta = { label: 'اتصل بنا', href: '#contact-1' };
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'SEM-005')).toBe(true);
    });

    it('passes when every anchor resolves and bare "#" is ignored', () => {
      const doc = structuredClone(validVetAr) as typeof validVetAr & {
        sections: Array<{ type: string; content: { primaryCta?: { href?: string }; links?: Array<{ href: string }> } }>;
      };
      const cta = doc.sections.find((s: { type: string }) => s.type === 'cta')!;
      cta.content.primaryCta = { label: 'اتصل بنا', href: '#features-1' };
      const footer = doc.sections.find((s: { type: string }) => s.type === 'footer')!;
      footer.content.links = [{ label: 'Top', href: '#' }];
      const result = validateSemantic(doc);
      expect(result.errors.some((e) => e.ruleId === 'SEM-005')).toBe(false);
    });
  });

  describe('SEM-006: no template placeholders at publish (review و)', () => {
    it('should fail when any text slot carries a [...] placeholder', () => {
      const doc = structuredClone(validVetAr) as typeof validVetAr & {
        sections: Array<{ type: string; content: Record<string, unknown> }>;
      };
      const hero = doc.sections.find((s: { type: string }) => s.type === 'hero')!;
      hero.content.subtitle = 'نص [اسم الشركة] الوصفي';
      const result = validateSemantic(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'SEM-006' && e.path.includes('subtitle'))).toBe(true);
    });
  });
});
