/**
 * Component Registry
 *
 * Maps Page Schema section types → React components.
 * Per master prompt §5.5: registry.ts (render map) and the generated JSON Schemas
 * MUST stay in lockstep — CI check (codegen-check.mjs in page-schema).
 *
 * The renderer uses ONLY this map. Unknown types never execute — they fall back safely.
 */

import React from 'react';
import {
  Header,
  Hero,
  Features,
  Cta,
  Footer,
  Testimonials,
  Pricing,
  Faq,
  Gallery,
  Contact,
} from './sections';

export type SectionRenderer = React.ComponentType<{
  id?: string;
  content: Record<string, unknown>;
  layoutHint?: Record<string, unknown>;
}>;

export const SECTION_COMPONENTS: Record<string, SectionRenderer> = {
  header: Header as unknown as SectionRenderer,
  hero: Hero as unknown as SectionRenderer,
  features: Features as unknown as SectionRenderer,
  testimonials: Testimonials as unknown as SectionRenderer,
  pricing: Pricing as unknown as SectionRenderer,
  faq: Faq as unknown as SectionRenderer,
  gallery: Gallery as unknown as SectionRenderer,
  contact: Contact as unknown as SectionRenderer,
  cta: Cta as unknown as SectionRenderer,
  footer: Footer as unknown as SectionRenderer,
};

export function lookupComponent(type: string): SectionRenderer | undefined {
  return SECTION_COMPONENTS[type];
}

export function getRegisteredTypes(): string[] {
  return Object.keys(SECTION_COMPONENTS);
}