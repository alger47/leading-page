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

export function Render({ schema, onLog }: RenderProps) {
  const page = (schema?.page ?? {}) as { title?: string; locale?: string; direction?: string; seo?: unknown };
  const locale = page.locale ?? 'en';
  const direction =
    page.direction === 'rtl' || page.direction === 'ltr' ? page.direction : directionFromLocale(locale);
  const theme = resolveTheme(schema);

  const sections = Array.isArray(schema?.sections) ? (schema.sections as Array<Record<string, unknown>>) : [];

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