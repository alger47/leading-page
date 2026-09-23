/**
 * L2 Semantic Validation
 * 
 * Validates the Page Schema against semantic rules.
 * This is the second validation layer - it checks business logic and content quality.
 * 
 * Per master prompt §8.2:
 * - L2 errors block render/publish
 * - L2 warnings surface in editor
 */

export interface SemanticRule {
  id: string;
  severity: 'error' | 'warning';
  description: string;
}

export interface ValidationError {
  layer: 'semantic';
  ruleId: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
  fixable: boolean;
  stage?: string;
  attempt?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Available semantic rules (seed catalog from §8.2).
 */
export const SEMANTIC_RULES: SemanticRule[] = [
  {
    id: 'SEM-001',
    severity: 'error',
    description: 'Exactly one hero; hero is the first content section',
  },
  {
    id: 'SEM-002',
    severity: 'error',
    description: 'hero.title non-empty, 2-14 words',
  },
  {
    id: 'SEM-003',
    severity: 'error',
    description: '>= 1 actionable CTA within the first two content sections',
  },
  {
    id: 'SEM-004',
    severity: 'error',
    description: 'Page ends with a footer',
  },
  {
    id: 'SEM-005',
    severity: 'error',
    description: 'Every internal #anchor resolves to an existing section id',
  },
  {
    id: 'SEM-006',
    severity: 'error',
    description: 'No template placeholders ([...]) reach the publish gate',
  },
];

interface PageSchema {
  page: {
    locale: string;
    direction: string;
  };
  theme: {
    preset: string;
    font: string;
    primaryColor: string;
    radius: string;
    density: string;
  };
  sections: Array<{
    id: string;
    type: string;
    variant: string;
    content: Record<string, unknown>;
  }>;
}

/**
 * SEM-001: Exactly one hero; hero is the first content section.
 */
function validateSEM001(schema: PageSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  const contentSections = schema.sections.filter((s) => s.id !== 'header-1' && s.id !== 'footer-1');
  
  const heroSections = contentSections.filter((s) => s.type === 'hero');
  
  if (heroSections.length === 0) {
    errors.push({
      layer: 'semantic',
      ruleId: 'SEM-001',
      severity: 'error',
      path: '$.sections',
      message: 'No hero section found',
      fixable: true,
    });
  } else if (heroSections.length > 1) {
    errors.push({
      layer: 'semantic',
      ruleId: 'SEM-001',
      severity: 'error',
      path: '$.sections',
      message: `Expected exactly 1 hero section, found ${heroSections.length}`,
      fixable: true,
    });
  }
  
  // Check hero is first content section (after header)
  const firstContentSection = contentSections[0];
  if (firstContentSection && firstContentSection.type !== 'hero') {
    errors.push({
      layer: 'semantic',
      ruleId: 'SEM-001',
      severity: 'error',
      path: `$.sections[0]`,
      message: 'Hero must be the first content section',
      fixable: true,
    });
  }
  
  return errors;
}

/**
 * SEM-002: hero.title non-empty, 2-14 words.
 */
function validateSEM002(schema: PageSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const heroSection = schema.sections.find((s) => s.type === 'hero');
  if (!heroSection) return errors; // SEM-001 will catch missing hero
  
  const title = heroSection.content.title as string | undefined;
  
  if (!title || title.trim().length === 0) {
    errors.push({
      layer: 'semantic',
      ruleId: 'SEM-002',
      severity: 'error',
      path: `$.sections[?(@.type=="hero")].content.title`,
      message: 'Hero title must not be empty',
      fixable: true,
    });
    return errors;
  }
  
  const wordCount = title.trim().split(/\s+/).length;
  
  if (wordCount < 2 || wordCount > 14) {
    errors.push({
      layer: 'semantic',
      ruleId: 'SEM-002',
      severity: 'error',
      path: `$.sections[?(@.type=="hero")].content.title`,
      message: `Hero title must be 2-14 words, found ${wordCount}`,
      fixable: true,
    });
  }
  
  return errors;
}

/**
 * SEM-003: >= 1 actionable CTA within the first two content sections.
 */
function validateSEM003(schema: PageSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const contentSections = schema.sections.filter((s) => s.id !== 'header-1' && s.id !== 'footer-1');
  const firstTwoSections = contentSections.slice(0, 2);
  
  let hasCTA = false;
  
  for (const section of firstTwoSections) {
    const content = section.content;
    
    // Check for primaryCta or secondaryCta
    if (content.primaryCta || content.secondaryCta) {
      hasCTA = true;
      break;
    }
    
    // Check for navCta in header
    if (content.navCta) {
      hasCTA = true;
      break;
    }
  }
  
  if (!hasCTA) {
    errors.push({
      layer: 'semantic',
      ruleId: 'SEM-003',
      severity: 'error',
      path: '$.sections[0..1]',
      message: 'No actionable CTA in the first two content sections',
      fixable: true,
    });
  }
  
  return errors;
}

/**
 * SEM-004: Page ends with a footer.
 */
function validateSEM004(schema: PageSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const lastSection = schema.sections[schema.sections.length - 1];
  
  if (!lastSection || lastSection.type !== 'footer') {
    errors.push({
      layer: 'semantic',
ruleId: 'SEM-004',
      severity: 'error',
      path: '$.sections',
      message: 'Page must end with a footer section',
      fixable: true,
    });
  }

  return errors;
}

const PLACEHOLDER = /(?:^|[\s.:\-،,])\[[^\]\n]{1,60}\](?:[\s.:\-،,]|$)/;
const ANCHOR = /^#([a-z][a-z0-9-]*[a-z0-9])$/;

/**
 * SEM-005: every internal `#anchor` must resolve to a section id. Anchors that
 * go nowhere are broken navigational promises — a "CTA to nothing" must never
 * pass the publish gate (review و, internal-refs).
 */
function validateSEM005(schema: PageSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = new Set(schema.sections.map((s) => s.id));

  function walkTargets(node: unknown, path: string): void {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkTargets(item, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`;
      if ((key === 'href' || key === 'url') && typeof value === 'string' && value.startsWith('#')) {
        const match = ANCHOR.exec(value);
        if (match && !ids.has(match[1])) {
          errors.push({
            layer: 'semantic',
            ruleId: 'SEM-005',
            severity: 'error',
            path: currentPath,
            message: `Internal anchor "${value}" does not resolve to any section id`,
            fixable: true,
          });
        }
      }
      walkTargets(value, currentPath);
    }
  }

  for (const [index, section] of schema.sections.entries()) {
    walkTargets(section.content ?? {}, `$.sections[${index}].content`);
  }
  return errors;
}

/**
 * SEM-006: template placeholders ([...] like "[Business name]", "[Phone]")
 * must never be published as public content. The engine legitimately emits
 * drafts with placeholders; only the publish gate (TS L2) rejects them, so an
 * operator must fill them before go-live.
 */
function validateSEM006(schema: PageSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  const TEXT_KEYS = new Set([
    'title', 'subtitle', 'eyebrow', 'brandName', 'description', 'label', 'value',
    'message', 'quote', 'author', 'role', 'city', 'name', 'caption', 'address',
    'hours', 'note', 'tagline', 'legal', 'alt',
  ]);

  function walkText(node: unknown, path: string): void {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkText(item, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`;
      if (TEXT_KEYS.has(key) && typeof value === 'string' && PLACEHOLDER.test(value.trim())) {
        errors.push({
          layer: 'semantic',
          ruleId: 'SEM-006',
          severity: 'error',
          path: currentPath,
          message: `Template placeholder "${value.trim()}" must be filled before publishing`,
          fixable: true,
        });
      }
      walkText(value, currentPath);
    }
  }

  for (const [index, section] of schema.sections.entries()) {
    walkText(section.content ?? {}, `$.sections[${index}].content`);
  }
  return errors;
}

/**
 * Validate the Page Schema against all semantic rules.
 * 
 * @param schema - The Page Schema document to validate
 * @returns ValidationResult with errors and warnings
 */
export function validateSemantic(schema: unknown): ValidationResult {
  const pageSchema = schema as PageSchema;
  const allErrors: ValidationError[] = [];

  // Run all semantic validators
  allErrors.push(...validateSEM001(pageSchema));
  allErrors.push(...validateSEM002(pageSchema));
  allErrors.push(...validateSEM003(pageSchema));
  allErrors.push(...validateSEM004(pageSchema));
  allErrors.push(...validateSEM005(pageSchema));
  allErrors.push(...validateSEM006(pageSchema));

  const errors = allErrors.filter((e) => e.severity === 'error');
  const warnings = allErrors.filter((e) => e.severity === 'warning');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
