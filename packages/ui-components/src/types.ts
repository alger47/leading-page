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

export interface TestimonialItemContent {
  quote: string;
  name?: string;
  role?: string;
}

export interface TestimonialsContent {
  eyebrow?: string;
  title?: string;
  items: TestimonialItemContent[];
}

export interface PricingTierContent {
  name: string;
  price: string;
  features: string[];
  highlight?: boolean;
  cta?: CtaSlot;
}

export interface PricingContent {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  tiers: PricingTierContent[];
}

export interface FaqItemContent {
  question: string;
  answer: string;
}

export interface FaqContent {
  eyebrow?: string;
  title?: string;
  items: FaqItemContent[];
}

export interface GalleryItemContent {
  image?: MediaRefSlot;
  caption?: string;
}

export interface GalleryContent {
  eyebrow?: string;
  title?: string;
  items: GalleryItemContent[];
}

export interface ContactContent {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
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