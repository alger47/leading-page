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