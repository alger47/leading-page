/**
 * Product-page extraction (Phase 16 part 2, product-link generation).
 *
 * AliExpress pages embed their product state in `<script>` blocks
 * (`window.runParams` ≙ `__NEXT_DATA__`-style state) plus standard OG meta
 * tags. We never re-host their HTML: this module is a *tolerant* text
 * extractor — it scans the fetched document for the well-known fields
 * (title / price / bullets / image URLs) and returns plain primitives.
 *
 * The scan is layered so a marketplace redesign degrades gracefully:
 *   1. balanced-JSON parse of the `runParams`/`__INITIAL_STATE__` script blob;
 *   2. targeted regex sweeps over the raw document (survive a failed scan);
 *   3. OG meta tags (survive a full script-block change).
 * Never throws: any failure yields `EMPTY_PRODUCT`, and the caller decides how
 * to degrade (honest fallback to the manual brief path).
 */

export interface ExtractedProduct {
  title: string | null;
  /** Display price string, e.g. "US $12,99". */
  price: string | null;
  bullets: string[];
  /** Absolute image URLs, deduplicated, in page order (max 8). */
  images: string[];
}

export const EMPTY_PRODUCT: ExtractedProduct = { title: null, price: null, bullets: [], images: [] };

const TITLE_KEYS = new Set(['subject', 'title', 'name']);
const PRICE_KEYS = new Set(['formatedActivityPrice', 'activityPrice', 'price', 'salePrice', 'promotionPrice']);
const BULLET_KEYS = new Set(['featureList', 'productProp', 'bullets']);
const IMAGE_KEYS = new Set(['imagePathList', 'imageList', 'promotionMediaList', 'imagePath']);

/** Finds `marker` in `haystack`, then balanced-scans the first `{` after it
 * and parses the object. Returns null on any failure (a single unescaped
 * character aborts that layer — it never poisons the regex fallbacks). */
function parseMarkedJson(haystack: string, marker: string): Record<string, unknown> | null {
  const at = haystack.indexOf(marker);
  if (at === -1) return null;
  const open = haystack.indexOf('{', at + marker.length);
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < haystack.length && i < open + 5_000_000; i += 1) {
    const ch = haystack[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth <= 0) {
        try {
          return JSON.parse(haystack.slice(open, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface Collected {
  titles: string[];
  prices: string[];
  bullets: string[];
  images: string[];
}

const MAX_FIELD = 64;

/** Push every string leaf of a `featureList`-style subtree (bullet copy). */
function bulletSubtree(obj: unknown, out: string[], depth: number): void {
  if (depth > 10 || out.length >= MAX_FIELD) return;
  if (typeof obj === 'string') {
    out.push(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) bulletSubtree(item, out, depth + 1);
    return;
  }
  if (obj !== null && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) bulletSubtree(v, out, depth + 1);
  }
}

/** Single depth-first pass: leaves that match title/price/image keys, plus
 * bullet subtrees under their well-known container keys. */
function walk(obj: unknown, key: string, out: Collected, depth: number): void {
  if (depth > 10) return;
  if (typeof obj === 'string') {
    if (out.titles.length < MAX_FIELD && TITLE_KEYS.has(key)) out.titles.push(obj);
    else if (out.prices.length < MAX_FIELD && PRICE_KEYS.has(key)) out.prices.push(obj);
    else if (out.images.length < MAX_FIELD && IMAGE_KEYS.has(key)) out.images.push(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) walk(item, key, out, depth + 1);
    return;
  }
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (BULLET_KEYS.has(k)) bulletSubtree(v, out.bullets, 0);
      else walk(v, k, out, depth + 1);
    }
  }
}

function firstNonEmpty(values: string[]): string | null {
  const v = values.find((s) => typeof s === 'string' && s.trim() !== '');
  return v === undefined ? null : (v as string).trim();
}

function looksLikeImageUrl(value: string): boolean {
  const v = value.trim();
  if (!/(^https?:\/\/|^\/\/)/.test(v)) return false;
  const clean = v.split('?')[0].split('#')[0];
  return /\.(webp|png|jpe?g|avif|gif|bmp)$/i.test(clean) || /\/\d+$/.test(clean);
}

/** Best-guess absolute image URL out of a marketplace-relative one. */
export function absolutizeImageUrl(raw: string): string {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('//')) return `https:${v}`;
  return v;
}

function pickPrice(prices: string[]): string | null {
  const clean = prices.map((p) => p.trim().replace(/'/g, '')).filter((p) => p !== '');
  const formatted = clean.find((p) => /US \$|AED|EUR|SAR|,/.test(p));
  return formatted ?? firstNonEmpty(clean);
}

/**
 * Tolerant extraction — never throws, returns EMPTY_PRODUCT on any weirdness.
 * `baseUrl` is unused today (marketplace images are already absolute or
 * protocol-relative); kept in the signature for future relative-path hosts.
 */
export function extractProduct(html: string, _baseUrl: string): ExtractedProduct {
  const c: Collected = { titles: [], prices: [], bullets: [], images: [] };
  const seenImages = new Set<string>();
  const pushImage = (raw: string): void => {
    const absolute = absolutizeImageUrl(raw);
    if (absolute === '' || !looksLikeImageUrl(absolute)) return;
    if (seenImages.has(absolute)) return;
    seenImages.add(absolute);
    c.images.push(absolute);
  };

  // Layer 1 — balanced JSON from the well-known script state objects.
  for (const marker of ['window.runParams', 'window.__INITIAL_STATE__', 'window.RUNTIME_INFO']) {
    const json = parseMarkedJson(html, marker);
    if (json === null) continue;
    walk(json, '', c, 0);
    if (c.titles.length > 0 || c.prices.length > 0) break;
  }

  // Layer 2 — targeted regex sweeps over the raw document.
  if (c.titles.length === 0) {
    const m = html.match(/"subject"\s*:\s*"((?:\\.|[^"\\]){4,240})"/);
    if (m) c.titles.push(m[1]);
  }
  if (c.prices.length === 0) {
    const m = html.match(/"(formatedActivityPrice|promotionPrice|activityPrice)"\s*:\s*"((?:\\.|[^"\\]){1,60})"/);
    if (m) c.prices.push(m[2]);
  }
  if (c.bullets.length === 0) {
    for (const m of html.matchAll(/"featureList"\s*:\s*\[[\s\S]{0,8000}?\]/g)) {
      for (const b of m[0].matchAll(/"text"\s*:\s*"((?:\\.|[^"\\]){2,300})"/g)) {
        try {
          c.bullets.push(JSON.parse(`"${b[1]}"`));
        } catch {
          c.bullets.push(b[1]);
        }
      }
      if (c.bullets.length > 0) break;
    }
  }
  const listBlock = html.match(/"(?:imagePathList|imageList|promotionMediaList)"\s*:\s*\[[\s\S]{0,200000}?\]/);
  if (listBlock) {
    for (const url of listBlock[0].matchAll(/"(https?:\\?\/\\?\/[^"]+?\.(?:webp|png|jpe?g|gif|avif)[^"]*)"/gi)) {
      pushImage(url[1].replaceAll('\\/', '/'));
    }
  }

  // Layer 3 — OG meta tags.
  if (c.titles.length === 0) {
    const og =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,240})["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']{1,240})["'][^>]+property=["']og:title["']/i);
    if (og) c.titles.push(og[1]);
  }
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']{1,800})["']/gi)) {
    pushImage(m[1]);
  }

  const bulletsOut = Array.from(new Set(c.bullets.map((b) => b.trim()).filter((b) => b.length >= 2 && b.length <= 300))).slice(0, 8);

  // Final pass: absolutize + dedupe every collected image URL (Layer 1 feeds
  // the raw values in; Layer 2/3 already push absolutized ones).
  const imageOut: string[] = [];
  const seenImagesOut = new Set<string>();
  for (const raw of c.images.slice(0, MAX_FIELD)) {
    const absolute = absolutizeImageUrl(raw);
    if (absolute === '' || !looksLikeImageUrl(absolute)) continue;
    if (seenImagesOut.has(absolute)) continue;
    seenImagesOut.add(absolute);
    imageOut.push(absolute);
  }

  return {
    title: firstNonEmpty(c.titles),
    price: pickPrice(c.prices),
    bullets: bulletsOut,
    images: imageOut.slice(0, 8),
  };
}

/** Deterministic brief from an extraction — keep it under the engine's
 * 4000-char brief cap. The user can always edit it afterwards. */
export function suggestBrief(product: { title: string | null; price: string | null; bullets: string[] }, maxLength = 4_000): string {
  const parts: string[] = [];
  if (product.title) parts.push(`Product: ${product.title}`);
  if (product.price) parts.push(`Price: ${product.price}`);
  const bullets = product.bullets.slice(0, 6);
  if (bullets.length > 0) {
    parts.push('Highlights:', ...bullets.map((b) => `- ${b}`));
  }
  parts.push('Generate a high-converting landing page for this product.');
  let out = parts.join('\n');
  if (out.length > maxLength) out = out.slice(0, maxLength);
  return out;
}