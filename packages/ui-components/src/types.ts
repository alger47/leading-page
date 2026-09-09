/**
 * Section content slot types
 *
 * These mirror the registry content contracts (data, never markup).
 */

export interface CtaSlot {
  label: string;
  href: string;
}

export interface MediaRefSlot {
  assetRef: string;
  alt: string;
}

export interface NavItemSlot {
  label: string;
  href: string;
}

export interface HeaderContent {
  brandName: string;
  nav?: NavItemSlot[];
  navCta?: CtaSlot;
}

export interface HeroContent {
  title: string;
  subtitle?: string;
  primaryCta?: CtaSlot;
  secondaryCta?: CtaSlot;
  media?: MediaRefSlot;
  badges?: string[];
}

export interface FeatureItemContent {
  title: string;
  description: string;
  iconRef?: string;
}

export interface FeaturesContent {
  eyebrow?: string;
  title?: string;
  items: FeatureItemContent[];
  media?: MediaRefSlot;
}

export interface CtaContent {
  title: string;
  subtitle?: string;
  primaryCta?: CtaSlot;
  secondaryCta?: CtaSlot;
}

export interface FooterLinkContent {
  label: string;
  href: string;
}

export interface SocialLinkContent {
  platform: string;
  url: string;
}

export interface FooterContactContent {
  phone?: string;
  email?: string;
  address?: string;
}

export interface FooterContent {
  brandName: string;
  links: FooterLinkContent[];
  social?: SocialLinkContent[];
  legal?: string;
  contact?: FooterContactContent;
}

export interface SectionEnvelope {
  id: string;
  type: string;
  variant: string;
  content: Record<string, unknown>;
  layoutHint?: {
    mediaSide?: 'start' | 'end';
    columns?: number;
    align?: 'start' | 'center' | 'end';
  };
  visibility?: {
    mobile?: boolean;
    desktop?: boolean;
  };
}