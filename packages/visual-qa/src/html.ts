/**
 * Standalone HTML document construction (Phase 12 — visual-qa).
 *
 * Renders the SAME ui-components Renderer used by preview and production into
 * static markup (react-dom/server), then wraps it in a real HTML document that
 * carries the envelope's lang/dir/title so the headless page is faithful to
 * the served (published)/[host] route.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Render } from '@landing-ai/ui-components';

export interface PageMeta {
  title?: string;
  locale?: string;
  direction?: string;
}

export function envelopeMeta(schema: Record<string, unknown>): PageMeta {
  const page = (schema?.page ?? {}) as { title?: string; locale?: string; direction?: string };
  return { title: page.title, locale: page.locale, direction: page.direction };
}

export function renderPageMarkup(schema: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(Render, { schema }));
}

export function buildDocument(schema: Record<string, unknown>): string {
  const { title, locale, direction } = envelopeMeta(schema);
  const lang = typeof locale === 'string' && locale.length >= 2 ? locale.slice(0, 2) : 'en';
  const dir = direction === 'rtl' || direction === 'ltr' ? direction : undefined;
  const safeTitle = typeof title === 'string' ? title.replace(/</g, '&lt;') : 'Generated Landing Page';
  return [
    '<!doctype html>',
    `<html lang="${lang}"${dir ? ` dir="${dir}"` : ''}>`,
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${safeTitle}</title>`,
    '</head>',
    '<body style="margin:0">',
    renderPageMarkup(schema),
    '</body>',
    '</html>',
  ].join('\n');
}