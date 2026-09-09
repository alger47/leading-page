/**
 * @landing-ai/ui-components
 *
 * Schema-driven section components and deterministic renderer.
 * Slots are data — never executed markup.
 */

export { Render, Container } from './Renderer';
export type { RenderProps, RenderLogEntry } from './Renderer';
export { ThemeProvider, useTheme } from './theme/ThemeProvider';
export type { ThemeProviderProps, ThemeContextValue } from './theme/ThemeProvider';
export { SECTION_COMPONENTS, lookupComponent, getRegisteredTypes } from './registry';
export * from './primitives';
export type {
  CtaSlot,
  MediaRefSlot,
  NavItemSlot,
  HeaderContent,
  HeroContent,
  FeatureItemContent,
  FeaturesContent,
  CtaContent,
  FooterLinkContent,
  SocialLinkContent,
  FooterContactContent,
  FooterContent,
  SectionEnvelope,
} from './types';