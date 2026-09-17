/**
 * L1 Structural Validation
 * 
 * Validates the Page Schema against the JSON Schema definition.
 * This is the first validation layer - it checks structural correctness.
 * 
 * Per master prompt §8.1:
 * - L1 errors block render
 * - Structural validity NEVER implies semantic quality
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import envelopeSchema from '../../schema/envelope.schema.json';

import { isSafeHref } from '../schemes.js';

export interface ValidationError {
  layer: 'structural';
  ruleId: string;
  severity: 'error';
  path: string;
  message: string;
  fixable: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

const validateSchema = ajv.compile(envelopeSchema);

/**
 * Validate a Page Schema document against the JSON Schema.
 * 
 * @param document - The Page Schema document to validate
 * @returns ValidationResult with valid flag and any errors
 */
export function validateStructural(document: unknown): ValidationResult {
  const valid = validateSchema(document) as boolean;

  if (valid) {
    const hrefErrors = validateHrefSchemes(document as Parameters<typeof validateHrefSchemes>[0]);
    if (hrefErrors.length > 0) {
      return { valid: false, errors: hrefErrors };
    }
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validateSchema.errors || []).map((err) => ({
    layer: 'structural' as const,
    ruleId: 'E-VAL-STRUCT-001',
    severity: 'error' as const,
    path: err.instancePath || '/',
    message: err.message || 'Structural validation error',
    fixable: false,
  }));

  return { valid: false, errors };
}

/**
 * Validate section ID uniqueness.
 * 
 * @param sections - Array of sections to check
 * @returns Array of validation errors for duplicate IDs
 */
export function validateSectionIdUniqueness(
  sections: Array<{ id: string }>
): ValidationError[] {
  const seen = new Set<string>();
  const errors: ValidationError[] = [];

  for (const section of sections) {
    if (seen.has(section.id)) {
      errors.push({
        layer: 'structural',
        ruleId: 'E-VAL-STRUCT-002',
        severity: 'error',
        path: `$.sections[?(@.id=="${section.id}")]`,
        message: `Duplicate section ID: "${section.id}"`,
        fixable: true,
      });
    }
    seen.add(section.id);
  }

  return errors;
}

/**
 * Validate asset references in sections.
 * 
 * @param sections - Array of sections with asset references
 * @param assets - Array of available assets
 * @returns Array of validation errors for missing assets
 */
export function validateAssetReferences(
  sections: Array<{ content: Record<string, unknown> }>,
  assets: Array<{ id: string }>
): ValidationError[] {
  const assetIds = new Set(assets.map((a) => a.id));
  const errors: ValidationError[] = [];

  // Simple recursive search for assetRef in content
  function findAssetRefs(obj: unknown, path: string): void {
    if (obj === null || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => findAssetRefs(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`;
      
      if (key === 'assetRef' && typeof value === 'string') {
        if (!assetIds.has(value)) {
          errors.push({
            layer: 'structural',
            ruleId: 'E-VAL-STRUCT-003',
            severity: 'error',
            path: currentPath,
            message: `Asset reference not found: "${value}"`,
            fixable: false,
          });
        }
      }
      
      findAssetRefs(value, currentPath);
    }
  }

  sections.forEach((section, index) => {
    findAssetRefs(section.content, `$.sections[${index}].content`);
  });

  return errors;
}

/**
 * Validate that every user-supplied navigation target uses an allowed URL
 * scheme (§12.3 XSS mitigation). Walks all section content (keys `href`/`url`)
 * plus top-level `seo.canonical` and `assets[].url`; `javascript:`/`data:`/
 * control characters are rejected at L1 so a malicious target is blocked before
 * render — the renderer guard is the second, runtime-only line of defense.
 */
export function validateHrefSchemes(
  document: { sections?: Array<{ content?: Record<string, unknown> }>; assets?: Array<{ url?: unknown }>; page?: Record<string, unknown> },
): ValidationError[] {
  const errors: ValidationError[] = [];

  function walkNode(node: unknown, path: string): void {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkNode(item, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`;
      if ((key === 'href' || key === 'url') && typeof value === 'string' && !isSafeHref(value)) {
        errors.push({
          layer: 'structural',
          ruleId: 'E-VAL-STRUCT-004',
          severity: 'error',
          path: currentPath,
          message: `Unsafe URL scheme in "${value.slice(0, 60)}" — only http(s), mailto, tel, #, relative paths and internal asset: refs are allowed`,
          fixable: false,
        });
      }
      walkNode(value, currentPath);
    }
  }

  for (const [index, section] of (document.sections ?? []).entries()) {
    walkNode(section.content ?? {}, `$.sections[${index}].content`);
  }
  for (const [index, asset] of (document.assets ?? []).entries()) {
    if (typeof asset.url === 'string' && !isSafeHref(asset.url)) {
      errors.push({
        layer: 'structural',
        ruleId: 'E-VAL-STRUCT-004',
        severity: 'error',
        path: `$.assets[${index}].url`,
        message: `Unsafe URL scheme in "${asset.url.slice(0, 60)}"`,
        fixable: false,
      });
    }
  }
  const canonical = document.page?.seo as { canonical?: unknown } | undefined;
  if (typeof canonical?.canonical === 'string' && !isSafeHref(canonical.canonical)) {
    errors.push({
      layer: 'structural',
      ruleId: 'E-VAL-STRUCT-004',
      severity: 'error',
      path: '$.page.seo.canonical',
      message: `Unsafe URL scheme in canonical "${canonical.canonical.slice(0, 60)}"`,
      fixable: false,
    });
  }

  return errors;
}
