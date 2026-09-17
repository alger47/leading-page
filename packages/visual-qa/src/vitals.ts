/**
 * Published-page vitals probe (Phase 13 — Performance).
 *
 * Measures the §5.7 budgets against the SAME rendered document visual-qa audits:
 *   LCP  < 2.5 s
 *   CLS  < 0.1  (cumulative layout shift, buffered observer)
 *   INP  — not scripted here (no interaction fixture); reported as sentinel 0.
 * Plus first-load wall time, document bytes, and an image report (format,
 * intrinsic dimensions, transfer bytes) from ResourceTiming/DOM.
 *
 * The document is loaded through a real file:// navigation (never setContent),
 * so a genuine navigation entry, LargestContentfulPaint and LayoutShift get
 * recorded — numbers a fixture harness can honestly compare against the budget.
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Browser, BrowserContext } from 'playwright-core';

import { buildDocument } from './html.js';
import { type EnvelopeView } from './checks.js';

type PageFactory = Pick<BrowserContext, 'newPage'> | Pick<Browser, 'newPage'>;

export interface PageImageSample {
  src: string;
  format: string;
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
  complete: boolean;
}

export interface PageVitals {
  /** Server-side renderToStaticMarkup time (ms). */
  renderMs: number;
  /** Wall time to load the served document in a real navigation (ms). */
  loadMs: number;
  /** Largest Contentful Paint, ms; -1 when the API is unavailable. */
  lcpMs: number;
  /** Cumulative Layout Shift; -1 when the API is unavailable. */
  cls: number;
  /** Interaction to Next Paint — sentinel 0 (no interaction fixture). */
  inpMs: number;
  documentBytes: number;
  images: PageImageSample[];
  imageTransferBytes: number;
}

let probeSeq = 0;

/** Measure §5.7 vitals for one envelope through a fresh file:// navigation. */
export async function measureVitals(context: PageFactory, envelope: EnvelopeView): Promise<PageVitals> {
  const t0 = performance.now();
  const html = buildDocument(envelope as unknown as Record<string, unknown>);
  const renderMs = Math.round(performance.now() - t0);

  const file = join(tmpdir(), `landing-ai-vitals-${process.pid}-${probeSeq++}.html`);
  const page = await context.newPage();
  try {
    // LargestContentfulPaint only reaches the timeline through a live observer,
    // so install one init-script-early in the fresh document and read the value.
    await page.addInitScript(() => {
      const win = window as unknown as { __lcpMs?: number };
      win.__lcpMs = -1;
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length) win.__lcpMs = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint' });
      } catch {
        // LCP unsupported: the sentinel -1 is left in place.
      }
    });
    writeFileSync(file, html, 'utf8');
    const t1 = performance.now();
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 15_000 });
    await page.evaluate(`new Promise((r) => setTimeout(r, 400))`);
    const loadMs = Math.round(performance.now() - t1);

    const measured = (await page.evaluate(
      `(function (doc) {
        const win = window;
        const navigation = performance.getEntriesByType('navigation');
        const images = Array.from(doc.querySelectorAll('img')).map(function (img) {
          const src = img.currentSrc || img.src;
          const m = src.split('?')[0].match(/\\.([a-z0-9]+)$/i);
          return {
            src: src,
            format: m ? m[1].toLowerCase() : '',
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            width: img.width,
            height: img.height,
            complete: img.complete,
          };
        });
        const resources = performance.getEntriesByType('resource');
        var imageBytes = 0;
        for (var i = 0; i < resources.length; i++) {
          if (resources[i].initiatorType === 'img') imageBytes += resources[i].transferSize || 0;
        }
        return {
          lcpMs: typeof win.__lcpMs === 'number' ? Math.round(win.__lcpMs) : -1,
          loadEventMs: navigation.length ? Math.round(navigation[0].domContentLoadedEventEnd) : -1,
          imageBytes: imageBytes,
          images: images,
        };
      })(document)`,
    )) as { lcpMs: number; loadEventMs: number; imageBytes: number; images: PageImageSample[] };

    const cls = (await page.evaluate(
      `(async function () {
        try {
          var total = 0;
          var observer = new PerformanceObserver(function (list) {
            var entries = list.getEntries();
            for (var i = 0; i < entries.length; i++) {
              if (!entries[i].hadRecentInput) total += entries[i].value;
            }
          });
          observer.observe({ type: 'layout-shift', buffered: true });
          await new Promise(function (resolve) { setTimeout(resolve, 60); });
          observer.disconnect();
          return Math.round(total * 1000) / 1000;
        } catch (err) {
          return -1;
        }
      })()`,
    )) as number;

    return {
      renderMs,
      loadMs,
      lcpMs: measured.lcpMs,
      cls,
      inpMs: 0,
      documentBytes: Buffer.byteLength(html, 'utf8'),
      images: measured.images,
      imageTransferBytes: measured.imageBytes,
    };
  } finally {
    await page.close();
    try {
      unlinkSync(file);
    } catch {
      // Windows may still hold the file briefly; the temp entry is harmless.
    }
  }
}

/**
 * §5.7 budget comparison. Sentinels (-1 = API unavailable) are skipped; a
 * physically impossible 0 (or negative real value) is treated as a breach so
 * fabrications cannot silently pass.
 */
export function withinBudgets(vitals: Pick<PageVitals, 'lcpMs' | 'cls'>): boolean {
  const lcpOk = vitals.lcpMs === -1 || (vitals.lcpMs > 0 && vitals.lcpMs < 2500);
  const clsOk = vitals.cls === -1 || (vitals.cls >= 0 && vitals.cls < 0.1);
  return lcpOk && clsOk;
}