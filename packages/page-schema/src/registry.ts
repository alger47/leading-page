/**
 * Section Registry
 * 
 * The controlled catalog of section types/variants the renderer can render.
 * Per master prompt §5.5, every component must have:
 * - type + variants + JSON Schema of content slots
 * - Responsive behavior spec (375 / 768 / 1280)
 * - RTL behavior notes
 * - Accessibility contract
 * - Tests + at least one fixture per variant
 */

export interface SectionVariant {
  name: string;
  description: string;
  schemaRef: string;
}

export interface SectionType {
  type: string;
  description: string;
  variants: SectionVariant[];
  requiredSlots: string[];
  optionalSlots: string[];
}

/**
 * MVP Registry - Seed section taxonomy (from §4.7)
 * 
 * Registry entries must stay in lockstep with JSON Schemas.
 * Adding a component = schema + component + fixtures + prompts updated together.
 */
export const SECTION_REGISTRY: Record<string, SectionType> = {
  header: {
    type: 'header',
    description: 'Site branding and navigation',
    variants: [
      { name: 'basic', description: 'Simple header with brand and nav', schemaRef: 'header' },
      { name: 'with-cta', description: 'Header with CTA button in nav', schemaRef: 'header' },
    ],
    requiredSlots: ['brandName'],
    optionalSlots: ['nav', 'navCta'],
  },
  hero: {
    type: 'hero',
    description: 'Main banner at the top of the page',
    variants: [
      { name: 'split', description: 'Text + media side by side', schemaRef: 'hero' },
      { name: 'centered', description: 'Centered text with optional media below', schemaRef: 'hero' },
      { name: 'full-bleed', description: 'Full-width background image with overlay text', schemaRef: 'hero' },
      { name: 'minimal', description: 'Clean, minimal hero with text only', schemaRef: 'hero' },
    ],
    requiredSlots: ['title', 'primaryCta'],
    optionalSlots: ['subtitle', 'secondaryCta', 'media', 'badges'],
  },
  features: {
    type: 'features',
    description: 'Product/service feature showcase',
    variants: [
      { name: 'grid-3', description: '3-column grid layout', schemaRef: 'features' },
      { name: 'grid-4', description: '4-column grid layout', schemaRef: 'features' },
      { name: 'alternating', description: 'Alternating text/media layout', schemaRef: 'features' },
      { name: 'icon-row', description: 'Horizontal row with icons', schemaRef: 'features' },
    ],
    requiredSlots: ['items'],
    optionalSlots: ['eyebrow', 'title', 'media'],
  },
  cta: {
    type: 'cta',
    description: 'Call-to-action section',
    variants: [
      { name: 'banner', description: 'Full-width banner CTA', schemaRef: 'cta' },
      { name: 'boxed', description: 'Boxed/card-style CTA', schemaRef: 'cta' },
      { name: 'band', description: 'Colored band CTA', schemaRef: 'cta' },
    ],
    requiredSlots: ['title', 'primaryCta'],
    optionalSlots: ['subtitle', 'secondaryCta'],
  },
  footer: {
    type: 'footer',
    description: 'Site footer with links and legal',
    variants: [
      { name: 'basic', description: 'Simple footer with links', schemaRef: 'footer' },
      { name: 'extended', description: 'Extended footer with social and contact', schemaRef: 'footer' },
    ],
    requiredSlots: ['brandName', 'links'],
    optionalSlots: ['social', 'legal', 'contact'],
  },
  testimonials: {
    type: 'testimonials',
    description: 'Customer quotes (user-provided, never invented)',
    variants: [{ name: 'grid-3', description: '3-column quote grid', schemaRef: 'testimonials' }],
    requiredSlots: ['items'],
    optionalSlots: ['eyebrow', 'title'],
  },
  pricing: {
    type: 'pricing',
    description: 'Pricing tiers (amounts user-provided, never invented)',
    variants: [{ name: 'tiers-3', description: 'Three-tier pricing cards', schemaRef: 'pricing' }],
    requiredSlots: ['tiers'],
    optionalSlots: ['eyebrow', 'title', 'subtitle'],
  },
  faq: {
    type: 'faq',
    description: 'Frequently asked questions (user-provided)',
    variants: [{ name: 'accordion', description: 'Native details/summary accordion', schemaRef: 'faq' }],
    requiredSlots: ['items'],
    optionalSlots: ['eyebrow', 'title'],
  },
  gallery: {
    type: 'gallery',
    description: 'Image gallery with captions',
    variants: [{ name: 'grid-3', description: '3-column image grid', schemaRef: 'gallery' }],
    requiredSlots: ['items'],
    optionalSlots: ['eyebrow', 'title'],
  },
  contact: {
    type: 'contact',
    description: 'Contact details block',
    variants: [{ name: 'split', description: 'Heading plus contact cards', schemaRef: 'contact' }],
    requiredSlots: [],
    optionalSlots: ['eyebrow', 'title', 'subtitle', 'phone', 'email', 'address', 'hours'],
  },
};

/**
 * Get a section type from the registry.
 * 
 * @param type - Section type identifier
 * @returns Section type definition or undefined
 */
export function getSectionType(type: string): SectionType | undefined {
  return SECTION_REGISTRY[type];
}

/**
 * Get all available section types.
 * 
 * @returns Array of section type identifiers
 */
export function getAvailableSectionTypes(): string[] {
  return Object.keys(SECTION_REGISTRY);
}

/**
 * Check if a section type/variant combination is valid.
 * 
 * @param type - Section type
 * @param variant - Section variant
 * @returns true if valid, false otherwise
 */
export function isValidSectionVariant(type: string, variant: string): boolean {
  const sectionType = SECTION_REGISTRY[type];
  if (!sectionType) return false;
  
  return sectionType.variants.some((v) => v.name === variant);
}
