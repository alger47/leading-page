/**
 * @landing-ai/page-schema
 * 
 * Canonical Page Schema package - the single contract for all subsystems.
 * 
 * This package provides:
 * - JSON Schema definitions (in schema/)
 * - TypeScript validators (structural + semantic)
 * - Section registry
 * - Type definitions
 * 
 * @packageDocumentation
 */

// Validators
export { validateStructural, validateSectionIdUniqueness, validateAssetReferences } from './validators/structural';
export { validateSemantic, SEMANTIC_RULES } from './validators/semantic';
export type { StructuralValidationError, SemanticValidationError, SemanticRule, ValidationResult } from './validators/index';

// Registry
export { SECTION_REGISTRY, getSectionType, getAvailableSectionTypes, isValidSectionVariant } from './registry';
export type { SectionType, SectionVariant } from './registry';

// Version
export { CURRENT_SCHEMA_VERSION, compareVersions, isValidSemver } from './version';

// Migrations
export { migrateDocument, getMigrationPath, needsMigration } from './migrations';
export type { Migration, MigrationFunction } from './migrations';
