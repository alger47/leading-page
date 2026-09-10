/**
 * Curated stock asset catalog (Phase 8 J3 image swap MVP). The editor lets a
 * user swap a section's media to one of these; the swap sets `media.assetRef`
 * and registers the asset in `schema.assets` (§SEM-011 shape) so the envelope
 * stays L1-clean.
 *
 * The catalog is the ONLY source of truth for the editor's asset picker; each
 * entry maps to a placeholder SVG served under /assets/stock/{id}.svg.
 */

export interface StockAsset {
  id: string;
  kind: 'illustration' | 'photo';
  source: 'stock';
  url: string;
  alt: string;
  /** Editor-only grouping label. */
  category: string;
  /** Suggested dominant color for the editor swatch. */
  accent: string;
}

const SVG_SUFFIX = `.svg`;

export const STOCK_ASSETS: readonly StockAsset[] = [
  {
    id: 'asset:stock-office',
    kind: 'illustration',
    source: 'stock',
    url: `/assets/stock/office${SVG_SUFFIX}`,
    alt: 'Illustration of a bright modern office',
    category: 'Workspace',
    accent: '#2563eb',
  },
  {
    id: 'asset:stock-retail',
    kind: 'illustration',
    source: 'stock',
    url: `/assets/stock/retail${SVG_SUFFIX}`,
    alt: 'Illustration of a boutique storefront',
    category: 'Commerce',
    accent: '#b45309',
  },
  {
    id: 'asset:stock-health',
    kind: 'illustration',
    source: 'stock',
    url: `/assets/stock/health${SVG_SUFFIX}`,
    alt: 'Illustration of a welcoming care facility',
    category: 'Health',
    accent: '#0d9488',
  },
  {
    id: 'asset:stock-gym',
    kind: 'illustration',
    source: 'stock',
    url: `/assets/stock/gym${SVG_SUFFIX}`,
    alt: 'Illustration of an energetic training space',
    category: 'Fitness',
    accent: '#e11d48',
  },
];

export function getStockAsset(id: string): StockAsset | undefined {
  return STOCK_ASSETS.find((a) => a.id === id);
}

/**
 * Presentation-time resolution of a logical `asset:` ref into a servable URL.
 *
 * The envelope stores LOGICAL refs (`asset:hero-saas`, `asset:gallery-…`) —
 * that is the contract (§SEM-011), the DB never changes. On screen, an `asset:`
 * scheme would be blocked by CSP (`img-src 'self'`) and shows as a broken
 * image. Resolution happens inside ui-components Render via `assetUrlFor`
 * (default self-hosted placeholder); this S3-aware variant is the host
 * override: when `NEXT_PUBLIC_ASSET_S3_BASE_URL` is configured it returns the
 * object-store public URL, else the local deterministic placeholder.
 */
export function resolveAssetUrl(ref: string): string {
  if (typeof ref === 'string' && ref.startsWith('asset:')) {
    const s3Base = process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL;
    if (s3Base) return `${s3Base.replace(/\/+$/, '')}/${encodeURIComponent(ref)}`;
    return `/assets/asset/${encodeURIComponent(ref)}`;
  }
  return ref;
}

/**
 * Deterministic placeholder SVG for any logical asset ref (self-hosted, so the
 * CSP `img-src 'self'` baseline is satisfied). Color + label derive from the
 * ref string only — same ref always renders the same placeholder.
 */
export function buildPlaceholderSvg(ref: string, width = 1200, height = 800): string {
  const hue = [...ref].reduce((acc, ch) => (acc + ch.charCodeAt(0)) % 360, 0);
  const label = ref
    .replace(/^asset:/, '')
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="hsl(${hue} 28% 92%)"/>`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="hsl(${hue} 35% 82%)" stroke-width="4"/>`,
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${Math.round(width / 22)}" font-weight="600" fill="hsl(${hue} 30% 24%)">${label}</text>`,
    `<text x="50%" y="${height / 2 + Math.round(width / 22) * 1.6}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${Math.round(height / 55)}" fill="hsl(${hue} 25% 45%)">Pending image — replace it in the editor</text>`,
    '</svg>',
  ].join('\n');
}