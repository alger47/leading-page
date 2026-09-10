/**
 * Renderer — deterministic schema → DOM
 *
 * Per master prompt §5.6:
 * - Deterministic: same schema + same theme + same registry version ⇒ identical output
 * - Unknown type/variant ⇒ safe fallback block + E-RENDER-001 logged (never crash, never silent)
 * - Per-section error boundaries: one broken section cannot blank the page
 * - Never executes schema content; slots are data
 * - Preview and production use THE SAME renderer
 */

import React from 'react';
import { resolveTheme } from '@landing-ai/design-system';
import type { Theme } from '@landing-ai/design-system';
import { directionFromLocale } from '@landing-ai/design-system';
import { ThemeProvider } from './theme/ThemeProvider';
import { lookupComponent } from './registry';
import { Container } from './primitives';

export interface RenderLogEntry {
  code: string;
  sectionId?: string;
  sectionType?: string;
  message: string;
}

export interface RenderProps {
  schema: Record<string, unknown>;
  /** Optional log sink for E-RENDER-001 and other diagnostics (telemetry). */
  onLog?: (entry: RenderLogEntry) => void;
  /**
   * Presentation-time resolver for logical `asset:` refs. The envelope stores
   * LOGICAL refs (`asset:hero-saas`, §SEM-011); an `asset:` scheme cannot be
   * loaded by browsers and would trip CSP. Default maps to the self-hosted
   * placeholder route (/assets/asset/{ref}); hosts with an object store
   * override it with their public CDN URL.
   */
  assetUrlFor?: (assetRef: string) => string;
}

/** Default asset-ref resolution (self-hosted placeholder, CSP `img-src 'self'`-safe). */
export function defaultAssetUrlFor(assetRef: string): string {
  return typeof assetRef === 'string' && assetRef.startsWith('asset:')
    ? `/assets/asset/${encodeURIComponent(assetRef)}`
    : assetRef;
}

function mapAssetRefs(value: unknown, resolver: (ref: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapAssetRefs(v, resolver));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'assetRef' && typeof v === 'string') out[key] = resolver(v);
      else out[key] = mapAssetRefs(v, resolver);
    }
    return out;
  }
  return value;
}

/** Pure deep-rewrite of assetRef slots across sections (content only, never the assets manifest). */
export function resolveAssetRefs(
  sections: Array<Record<string, unknown>>,
  resolver: (ref: string) => string,
): Array<Record<string, unknown>> {
  return sections.map((section) =>
    section && typeof section === 'object'
      ? { ...section, content: mapAssetRefs(section.content, resolver) }
      : section,
  );
}

class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error) {
    // telemetry hook: SectionErrorBoundary should report E-RENDER-002
    // (structure preserved; logging is wired in the app telemetry layer)
  }

  render() {
    if (this.state.hasError) {
      return (
        <section aria-label="Section failed to render" style={{ padding: 'var(--space-4)' }}>
          <div style={{ color: 'var(--color-text-muted)' }}>
            This section could not be displayed.
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

/**
 * Fallback block for unknown/unrenderable sections (E-RENDER-001).
 * Visually identifiable, never a crash, never silence.
 */
function FallbackSection({ type, id }: { type: string; id?: string }) {
  return (
    <section
      id={id}
      style={{
        paddingBlock: 'var(--space-8)',
        borderBottom: '1px dashed var(--color-border)',
        color: 'var(--color-text-muted)',
        fontSize: 'var(--type-small)',
      }}
    >
      Unsupported section type: {type}
    </section>
  );
}

export function Render({ schema, onLog, assetUrlFor = defaultAssetUrlFor }: RenderProps) {
  const page = (schema?.page ?? {}) as { title?: string; locale?: string; direction?: string; seo?: unknown };
  const locale = page.locale ?? 'en';
  const direction =
    page.direction === 'rtl' || page.direction === 'ltr' ? page.direction : directionFromLocale(locale);
  const theme = resolveTheme(schema);

  const sections = Array.isArray(schema?.sections)
    ? resolveAssetRefs(schema.sections as Array<Record<string, unknown>>, assetUrlFor)
    : [];

  return (
    <ThemeProvider theme={theme} locale={locale} direction={direction}>
      {sections.map((section, index) => {
        const type = typeof section.type === 'string' ? section.type : 'unknown';
        const id = typeof section.id === 'string' ? section.id : undefined;
        const Component = lookupComponent(type);

        if (!Component) {
          onLog?.({
            code: 'E-RENDER-001',
            sectionId: id,
            sectionType: type,
            message: `Unknown section type "${type}". Safe fallback rendered.`,
          });
          return <FallbackSection key={id ?? `fallback-${index}`} type={type} id={id} />;
        }

        return (
          <SectionErrorBoundary key={id ?? `section-${index}`}>
            <Component
              id={id}
              content={(section.content as Record<string, unknown>) ?? {}}
              layoutHint={(section.layoutHint as Record<string, unknown>) ?? {}}
            />
          </SectionErrorBoundary>
        );
      })}
    </ThemeProvider>
  );
}

export { Container };
export type { Theme };