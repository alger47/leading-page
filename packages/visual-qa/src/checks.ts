/**
 * VIS-001..007 — deterministic visual QA checks (Phase 12).
 *
 * Every check runs entirely inside a headless Chrome tab over the SAME DOM the
 * renderer produces, so it measures what a user actually sees (computed styles,
 * geometry, contrast) — never the source JSON. All checks are offline and
 * deterministic; imagery availability is advisory (the harness has no asset
 * endpoint), so unloadable <img> sources degrade to a warning, never a fail.
 *
 * Tiering: checks mirror the product's "minimum vs ideal" contract elsewhere in
 * the suite — HARD = minimally usable (layout collapse, unreadable text, a CTA
 * you cannot tap, broken landmarks); WARN = below the "good" target (AA
 * contrast, comfortable 44px targets, inline text links on the WCAG 2.5.8
 * exemption). TOP-LEVEL blocks are the ThemeProvider wrapper's direct children:
 * nested landmarks (a <header> inside a <section>, etc.) are legal HTML5 and
 * must not be mistaken for page structure.
 */

import type { Page } from 'playwright-core';

export type CheckStatus = 'pass' | 'fail';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  details: string[];
}

export interface EnvelopeView {
  schemaVersion?: string;
  page?: { title?: string; locale?: string; direction?: string };
  sections?: Array<{ id?: string; type?: string; variant?: string }>;
}

/**
 * Page-side probing function. Runs inside the browser context; keeps all
 * geometry/color math on the tab to avoid serializing style state. It must be
 * fully self-contained (constants inlined) because the browser tab executes the
 * function source verbatim via toString().
 */
function probeDocument(doc: Document) {
  const linearize = (v: number): number =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  interface Rect {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }
  const TEXT_SAMPLES = [
    { selector: 'h1', label: 'hero title' },
    { selector: 'h2, h3', label: 'section heading' },
    { selector: 'p', label: 'paragraph' },
    { selector: 'header nav a', label: 'nav link' },
    { selector: 'footer a', label: 'footer link' },
    { selector: 'a[href]', label: 'call-to-action' },
  ];
  const PARTIAL_SAMPLE_LIMIT = 8;
  const root = doc.documentElement;
  const body = doc.body;
  const wrapper = body.firstElementChild as HTMLElement | null;
  const topBlocks = wrapper ? (Array.from(wrapper.children) as HTMLElement[]) : [];

  const fmt = (v: number): string => String(Math.round(v * 100) / 100);

  const parseRgb = (value: string): [number, number, number] | null => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };

  const luminance = (rgb: [number, number, number] | null): number => {
    if (!rgb) return 0;
    return 0.2126 * linearize(rgb[0] / 255) + 0.7152 * linearize(rgb[1] / 255) + 0.0722 * linearize(rgb[2] / 255);
  };

  const contrast = (a: string, b: string): number | null => {
    const la = luminance(parseRgb(a));
    const lb = luminance(parseRgb(b));
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return hi === lo ? null : (hi + 0.05) / (lo + 0.05);
  };

  const paintedBackground = (el: HTMLElement): string => {
    let node: HTMLElement | null = el;
    while (node) {
      const value = getComputedStyle(node).backgroundColor;
      if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
      node = node.parentElement;
    }
    const bdr = getComputedStyle(body).backgroundColor;
    return bdr && bdr !== 'rgba(0, 0, 0, 0)' && bdr !== 'transparent' ? bdr : 'rgb(255, 255, 255)';
  };

  const elementText = (el: HTMLElement): string =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');

  // VIS-005 — legibility floors (hard) vs WCAG AA (advisory).
  const textIssues: string[] = [];
  const textWarnings: string[] = [];
  const textSamples: Array<{ label: string; ratio: number; size: number }> = [];
  let textSamplesMeasured = 0;
  for (const sample of TEXT_SAMPLES) {
    const els = Array.from(doc.querySelectorAll(sample.selector)) as HTMLElement[];
    for (const el of els.slice(0, PARTIAL_SAMPLE_LIMIT)) {
      if (!elementText(el)) continue;
      const cs = getComputedStyle(el);
      const ratio = contrast(cs.color, paintedBackground(el));
      if (ratio !== null) textSamplesMeasured += 1;
      const size = parseFloat(cs.fontSize) || 16;
      const large = size >= 18;
      if (ratio !== null) {
        textSamples.push({ label: sample.label, ratio: Math.round(ratio * 100) / 100, size });
        if ((large && ratio < 2.2) || (!large && ratio < 3)) {
          textIssues.push(
            `${sample.label} contrast ${fmt(ratio)} < ${large ? 2.2 : 3} (${el.tagName.toLowerCase()}, ${size}px)`,
          );
        } else if ((large && ratio < 3) || (!large && ratio < 4.5)) {
          textWarnings.push(
            `${sample.label} below WCAG AA contrast (${fmt(ratio)}, ${el.tagName.toLowerCase()}, ${size}px)`,
          );
        }
      }
    }
  }

  const topRects: Rect[] = topBlocks.map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  const horizontalOverflow = root.scrollWidth - root.clientWidth > 1 || body.scrollWidth - body.clientWidth > 1;
  let overlapIssues = 0;
  for (let i = 0; i < topRects.length; i++) {
    for (let j = i + 1; j < topRects.length; j++) {
      const a = topRects[i];
      const b = topRects[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) overlapIssues += 1;
    }
  }
  let outOfOrder = 0;
  for (let i = 1; i < topRects.length; i++) {
    if (topRects[i].top < topRects[i - 1].bottom - 2) outOfOrder += 1;
  }
  const viewportWidth = root.clientWidth;
  const outOfViewport = topRects.filter((r) => r.left < -2 || r.right > viewportWidth + 2).length;

  const htmlDir = root.getAttribute('dir');
  const htmlLang = root.getAttribute('lang');
  const wrapperDir = wrapper ? getComputedStyle(wrapper).direction : undefined;

  const readToken = (name: string): string =>
    wrapper ? (getComputedStyle(wrapper).getPropertyValue(name).trim() || '') : '';
  const themeTokenColors = [
    readToken('--color-bg'),
    readToken('--color-primary'),
    readToken('--color-heading'),
    readToken('--color-text'),
  ];

  const heading = doc.querySelector('h1');
  const heroFamily = heading ? getComputedStyle(heading).fontFamily.trim() : '';

  const fontIssues: string[] = [];
  for (const el of Array.from(doc.querySelectorAll('body *')) as HTMLElement[]) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (Number.isFinite(size) && size <= 0) {
      fontIssues.push(`${el.tagName.toLowerCase()} is rendered at a non-measurable font size`);
      break;
    }
  }

  const images = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];
  const mediaIssues: string[] = [];
  const mediaWarnings: string[] = [];
  for (const img of images) {
    if (!(img.alt ?? '').trim()) mediaIssues.push(`<img> missing alt text (src=${img.src.slice(0, 60)})`);
    if (img.complete && img.naturalWidth === 0) {
      mediaWarnings.push(`image unloadable here (harness has no asset server): ${img.src.slice(0, 60)}`);
    }
  }

  // VIS-007 — button-like CTAs need real targets; inline text links (brand,
  // nav, footer) fall under the WCAG 2.5.8 inline exemption and are advisory.
  const anchors = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const ctaIssues: string[] = [];
  const ctaWarnings: string[] = [];
  for (const a of anchors) {
    const label = (a.textContent ?? '').trim();
    if (!label || label === '#') ctaIssues.push('anchor has no visible label');
    const r = a.getBoundingClientRect();
    const display = getComputedStyle(a).display;
    const buttonLike = display === 'inline-flex' || display === 'flex';
    if (buttonLike) {
      if (r.width < 22 || r.height < 22) {
        ctaIssues.push(`interactive target too small (${fmt(r.width)}x${fmt(r.height)})`);
      } else if (r.width < 44 || r.height < 44) {
        ctaWarnings.push(`interactive target below comfortable size (${fmt(r.width)}x${fmt(r.height)})`);
      }
    } else if (r.width < 20 || r.height < 20) {
      ctaWarnings.push(`inline text link target small (${fmt(r.width)}x${fmt(r.height)})`);
    }
  }
  if (anchors.length === 0) ctaIssues.push('no interactive call-to-action rendered');

  return {
    htmlDir,
    htmlLang,
    wrapperDir,
    topBlockCount: topBlocks.length,
    topTags: topBlocks.map((el) => (el.id ? `${el.tagName}#${el.id}` : el.tagName)),
    h1Count: doc.querySelectorAll('h1').length,
    horizontalOverflow,
    overlapIssues,
    outOfOrder,
    outOfViewport,
    textIssues,
    textWarnings,
    textSamples,
    textSamplesMeasured,
    fontIssues,
    heroFamily,
    themeTokenColors,
    mediaIssues,
    mediaWarnings,
    ctaIssues,
    ctaWarnings,
    anchorCount: anchors.length,
    unsupported: body.textContent?.includes('Unsupported section type') ?? false,
    failedBoundary: body.textContent?.includes('could not be displayed') ?? false,
  };
}

export async function runChecks(page: Page, envelope: EnvelopeView): Promise<CheckResult[]> {
  const probe = (await page.evaluate(`(${probeDocument.toString()})(document)`)) as ReturnType<typeof probeDocument>;
  const results: CheckResult[] = [];

  const expectedTypes = (envelope.sections ?? [])
    .map((s) => s?.type)
    .filter((t): t is string => Boolean(t));
  const supported = new Set(['header', 'hero', 'features', 'cta', 'footer']);

  const push = (id: string, title: string, issues: string[], whenPass: string[]): void => {
    results.push({ id, title, status: issues.length ? 'fail' : 'pass', details: issues.length ? issues : whenPass });
  };

  // VIS-001 — complete, ordered, un-fallen render (E-RENDER-001/002 regressions).
  const vis1: string[] = [];
  if (probe.unsupported) vis1.push('renderer fell back for an unknown section type (E-RENDER-001)');
  if (probe.failedBoundary) vis1.push('a section hit its error boundary (E-RENDER-002)');
  if (probe.h1Count !== 1) vis1.push(`expected exactly one h1, found ${probe.h1Count}`);
  if (probe.topBlockCount !== expectedTypes.length) {
    vis1.push(`expected ${expectedTypes.length} sections, rendered ${probe.topBlockCount} top-level blocks`);
  }
  if (expectedTypes[0] === 'header' && probe.topTags[0] !== 'HEADER') {
    vis1.push(`page does not open with the <header> landmark (got ${probe.topTags[0] ?? 'none'})`);
  }
  if (expectedTypes[expectedTypes.length - 1] === 'footer' && probe.topTags[probe.topTags.length - 1] !== 'FOOTER') {
    vis1.push(`page does not close with the <footer> landmark (got ${probe.topTags[probe.topTags.length - 1] ?? 'none'})`);
  }
  for (const type of expectedTypes) {
    if (!supported.has(type)) vis1.push(`envelope declares unsupported section type: ${type}`);
  }
  push('VIS-001', 'complete render', vis1, ['all registered sections rendered; no fallback or per-section failure']);

  // VIS-002 — layout integrity: no overflow, no top-level overlap, document order.
  const vis2: string[] = [];
  if (probe.horizontalOverflow) vis2.push('page scrolls horizontally');
  if (probe.overlapIssues > 0) vis2.push(`${probe.overlapIssues} section overlap(s)`);
  if (probe.outOfOrder > 0) vis2.push(`${probe.outOfOrder} section(s) out of document order`);
  if (probe.outOfViewport > 0) vis2.push(`${probe.outOfViewport} section(s) wider than the viewport`);
  push('VIS-002', 'layout integrity', vis2, ['single-column stacking; no overflow or overlap']);

  // VIS-003 — direction & language fidelity (RTL/LTR).
  const vis3: string[] = [];
  const envelopeDirection = envelope.page?.direction;
  const envelopeLocale = envelope.page?.locale ?? '';
  if (envelopeDirection) {
    if (probe.htmlDir !== envelopeDirection) vis3.push(`html[dir]=${probe.htmlDir ?? 'missing'}, expected ${envelopeDirection}`);
    if (probe.wrapperDir !== envelopeDirection) vis3.push(`computed direction=${probe.wrapperDir}, expected ${envelopeDirection}`);
  }
  const expectedLang = envelopeLocale.length >= 2 ? envelopeLocale.slice(0, 2) : 'en';
  if (probe.htmlLang !== expectedLang) vis3.push(`html[lang]=${probe.htmlLang ?? 'missing'}, expected ${expectedLang}`);
  push('VIS-003', 'direction & language', vis3, [`lang=${probe.htmlLang}, dir=${probe.htmlDir ?? 'auto'} propagated to the document`]);

  // VIS-004 — theme tokens resolve to real, distinct painted colors.
  const transparent = /^rgba\(0,\s*0,\s*0,\s*0\)$/;
  const tokenNames = ['page background', 'primary', 'heading', 'body text'];
  const vis4: string[] = [];
  probe.themeTokenColors.forEach((value, index) => {
    if (!value || transparent.test(value)) vis4.push(`${tokenNames[index]} token did not resolve`);
  });
  const distinctTokens = new Set(probe.themeTokenColors.filter(Boolean)).size;
  if (distinctTokens < 2) vis4.push('theme tokens collapse to fewer than two distinct colors');
  push('VIS-004', 'theme applied', vis4, [`${distinctTokens} distinct painted theme tokens resolve`]);

  // VIS-005 — typography & contrast: themed font, measurable sizes, readable text.
  const vis5: string[] = [];
  if (!probe.heroFamily || probe.heroFamily === 'sans-serif') {
    vis5.push('hero heading computed font-family is generic (theme font did not apply)');
  }
  vis5.push(...probe.fontIssues, ...probe.textIssues);
  const warningText = probe.textWarnings.map((w) => `warn: ${w}`);
  const pass5 = [`theme font active (${probe.heroFamily})`, `${probe.textSamplesMeasured} text runs meet minimum contrast`];
  push('VIS-005', 'typography & contrast', vis5, pass5);
  results[results.length - 1].details.push(...warningText);

  // VIS-006 — media integrity: alt is hard, loadability is advisory.
  const vis6 = [...probe.mediaIssues];
  const details6 = vis6.length ? vis6 : ['all supplied images carry alt text'];
  results.push({ id: 'VIS-006', title: 'media integrity', status: vis6.length ? 'fail' : 'pass', details: details6 });
  for (const w of probe.mediaWarnings) results[results.length - 1].details.push(`warn: ${w}`);

  // VIS-007 — CTA operability: visible label, tappable target, present.
  const vis7 = probe.ctaIssues;
  const details7 = vis7.length ? vis7 : [`${probe.anchorCount} interactive target(s) render with labels and usable size`];
  results.push({ id: 'VIS-007', title: 'CTAs operable', status: vis7.length ? 'fail' : 'pass', details: details7 });
  for (const w of probe.ctaWarnings) results[results.length - 1].details.push(`warn: ${w}`);

  return results;
}