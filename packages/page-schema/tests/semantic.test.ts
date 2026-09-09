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

// AI-generated fixtures (Phase 5 — SchemaBuilder exports, engine drift-guarded)
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

    it('should validate ai-vet-ar-001.json with no errors (SchemaBuilder output)', () => {
      const result = validateSemantic(aiVetAr);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate ai-saas-en-001.json with no errors (SchemaBuilder output)', () => {
      const result = validateSemantic(aiSaasEn);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
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
});
