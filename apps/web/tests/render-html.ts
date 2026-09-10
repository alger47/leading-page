/**
 * SSR of a published snapshot for TESTS ONLY (Phase 10 — J5).
 *
 * Kept out of lib/ because App Router forbids importing react-dom/server from
 * a module reachable by a page. The production (published)/[host] page renders
 * the SAME components natively through RSC; this helper exists so tests can
 * assert the deterministic HTML without booting a Next server.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Render } from '@landing-ai/ui-components';

export function renderPublishedHtml(content: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(Render, { schema: content }));
}