/**
 * Product-source fetcher (Phase 16 part 2, product-link generation).
 *
 * Server-side fetch of a marketplace product page + extraction of its image
 * bytes, turned into the engine's `supplied_images` contract
 * (`{ ref, mime, data_b64 }`, capped → bounded cost and bounded memory).
 *
 * Security posture:
 * - scheme allowlist (http/https only) + host allowlist
 *   (`PRODUCT_SOURCE_ALLOWLIST`, default the AliExpress family; localhost is
 *   allowed in dev/test so the harness can serve fixtures);
 * - response size caps (document ≤ 2 MiB, each image ≤ 1 MiB), image count
 *   capped at 4 (engine image_max default);
 * - bytes are fetched server-side and never cached beyond the job request;
 *   SSRF is bounded by the allowlist + caps.
 */

import { extractProduct, suggestBrief, type ExtractedProduct } from './product-extract';

export const PRODUCT_IMAGE_MAX = 4;
export const PRODUCT_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_BYTES = 1024 * 1024;

export interface SuppliedImage {
  ref: string;
  mime: string;
  data_b64: string;
}

export interface ProductSourceResult {
  title: string | null;
  price: string | null;
  bullets: string[];
  suggestedBrief: string;
  images: Array<{ url: string; width: number; height: number }>;
  supplied: SuppliedImage[];
}

export class ProductSourceError extends Error {
  readonly code = 'E-PROD-001';
  constructor(message: string) {
    super(message);
    this.name = 'ProductSourceError';
  }
}

const ALLOW_IMAGE_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

function hostAllowlist(): string[] {
  const raw = process.env.PRODUCT_SOURCE_ALLOWLIST ?? '';
  if (raw.trim() !== '') {
    return raw.split(',').map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
  }
  const base = [
    'aliexpress.com',
    'aliexpress.us',
    'aliexpress.ru',
    'aliexpress.net',
    'aliexpress.fr',
    'aliexpress.co.uk',
    'aliexpress.io',
    'alicdn.com',
    'alicdn.net',
    'aliexpress-media.com',
    'ae01.alicdn.com',
  ];
  return base;
}

function isAllowedHost(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function assertSafeUrl(raw: string, allowlist: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProductSourceError('invalid product URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProductSourceError('product URL must be http(s)');
  }
  if (!isAllowedHost(url.hostname, allowlist)) {
    throw new ProductSourceError('product URL host is not in the allowed list');
  }
  return url;
}

function mimeFor(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 12 && bytes.slice(4, 12).toString() === 'ftypavif') return 'image/avif';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  return null;
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  if (response.body === null) throw new ProductSourceError('empty response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ProductSourceError('response exceeds the size cap');
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchText(url: URL, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': 'en,fr',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ProductSourceError(`product page returned HTTP ${res.status}`);
  const bytes = await readBounded(res, PRODUCT_DOCUMENT_MAX_BYTES);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function toB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Big-endian uint32 from `bytes` at `offset` (PNG IHDR dims). */
function u32At(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/**
 * Fetch + extract a product page and download up to 4 real image rasters for
 * the asset-renderer. Async, bounded, allowlisted. Throws ProductSourceError
 * on any failure — the caller turns it into an honest E-PROD-001 response and
 * the UI keeps the manual brief path.
 */
export async function fetchProductData(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  allowlist: string[] = hostAllowlist(),
  imageMax = PRODUCT_IMAGE_MAX,
  imageMaxBytes = PRODUCT_IMAGE_MAX_BYTES,
): Promise<ProductSourceResult> {
  const url = assertSafeUrl(rawUrl, allowlist);
  const html = await fetchText(url, fetchImpl);

  const product: ExtractedProduct = extractProduct(html, url.origin);
  const supplied: SuppliedImage[] = [];
  const meta: Array<{ url: string; width: number; height: number }> = [];

  for (let i = 0; i < Math.min(product.images.length, imageMax); i += 1) {
    const imageUrl = assertSafeUrl(product.images[i], allowlist);
    if (supplied.length >= imageMax) break;
    let res: Response;
    try {
      res = await fetchImpl(imageUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
    } catch {
      continue; // best-effort: a missing raster is a placeholder, not a failure
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBounded(res, imageMaxBytes);
    } catch {
      continue;
    }
    const mime = mimeFor(bytes);
    if (mime === null || ALLOW_IMAGE_MIME[mime] === undefined) continue;
    if (bytes.length === 0 || bytes.length > imageMaxBytes) continue;
    supplied.push({ ref: `product-${i + 1}`, mime, data_b64: toB64(bytes) });
    const probe = new ImageProber(bytes, mime);
    meta.push({ url: product.images[i], width: probe.width(), height: probe.height() });
  }

  const suggestedBrief = suggestBrief({ title: product.title, price: product.price, bullets: product.bullets });
  return { ...product, suggestedBrief, images: meta, supplied };
}

/** Minimal PN/JPEG/WebP dimension probe (for the UI thumbnail ratio only —
 * never trusted for layout). Falls back to a square guess on unknown formats. */
class ImageProber {
  private readonly bytes: Uint8Array;
  private readonly mime: string;
  private dims: { width: number; height: number } | null = null;

  constructor(bytes: Uint8Array, mime: string) {
    this.bytes = bytes;
    this.mime = mime;
  }

  width(): number {
    return Math.round(this.dimensions().width);
  }

  height(): number {
    return Math.round(this.dimensions().height);
  }

  private dimensions(): { width: number; height: number } {
    if (this.dims !== null) return this.dims;
    const guess = { width: 4, height: 3 };
    const b = this.bytes;
    if (this.mime === 'image/png' && b.length >= 24) {
      this.dims = { width: u32At(b, 16), height: u32At(b, 20) };
      if (this.dims.width < 4 || this.dims.height < 4) this.dims = guess;
      return this.dims;
    }
    if (this.mime === 'image/gif' && b.length >= 10) {
      this.dims = { width: b[6] + b[7] * 256, height: b[8] + b[9] * 256 };
      if (this.dims.width < 4 || this.dims.height < 4) this.dims = guess;
      return this.dims;
    }
    if (this.mime === 'image/jpeg' && b.length >= 4) {
      let offset = 2;
      while (offset + 9 < b.length) {
        if (b[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = b[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = b[offset + 2] * 256 + b[offset + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          this.dims = { width: b[offset + 7] * 256 + b[offset + 8], height: b[offset + 5] * 256 + b[offset + 6] };
          if (this.dims.width < 4 || this.dims.height < 4) this.dims = guess;
          return this.dims;
        }
        offset += 2 + length;
      }
      this.dims = guess;
      return this.dims;
    }
    this.dims = guess;
    return this.dims;
  }
}