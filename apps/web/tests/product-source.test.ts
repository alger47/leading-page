/**
 * Phase 16 part 2 — product-source fetcher against a local marketplace fixture
 * (allowlisted via PRODUCT_SOURCE_ALLOWLIST, which overrides the prod defaults
 * so the harness can serve 127.0.0.1). Verifies the supplied-images contract,
 * the SSRF allowlist, scheme restriction, and the size/bounding caps.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { fetchProductData, ProductSourceError } from '../lib/product-source';

process.env.PRODUCT_SOURCE_ALLOWLIST = '127.0.0.1,localhost,aliexpress.com';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 24-byte minimal PNG-ish blob, width=10 height=8 at the IHDR position. */
const TINY_PNG = Buffer.from([...PNG_SIG, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x08]);

const PAGE_HTML = `<!doctype html><html><head><script>
window.runParams = {"data":{"root":{"fields":{
  "titleModule":{"subject":"Local Test Product"},
  "priceModule":{"formatedActivityPrice":"AED 49,99"},
  "featureList":[{"text":"Free shipping"},{"text":"2-year warranty"}],
  "imagePathList":["http://127.0.0.1:PORT/1.webp","http://127.0.0.1:PORT/2.webp"]}
}}};
</script></head></html>`;

const OVERSIZE_PAGE_HTML = `<!doctype html><html><head><script>
window.runParams = {"data":{"root":{"fields":{
  "titleModule":{"subject":"Oversize Raster Product"},
  "imagePathList":["http://127.0.0.1:PORT/huge.webp"]}
}}};
</script></head></html>`;

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    const port = baseUrlPort();
    if (url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML.replaceAll('PORT', String(port)));
      return;
    }
    if (url === '/oversize') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(OVERSIZE_PAGE_HTML.replaceAll('PORT', String(port)));
      return;
    }
    if (url === '/1.webp' || url === '/2.webp') {
      res.writeHead(200, { 'content-type': 'image/webp' });
      res.end(TINY_PNG);
      return;
    }
    if (url === '/huge.webp') {
      res.writeHead(200, { 'content-type': 'image/webp' });
      const big = Buffer.from([...PNG_SIG, ...new Array(2 * 1024 * 1024).fill(0)]);
      res.end(big);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${baseUrlPort()}`;
});

function baseUrlPort(): number {
  const address = server?.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe('fetchProductData', () => {
  it('extracts the product and downloads allowlisted rasters into supplied', async () => {
    const result = await fetchProductData(`${baseUrl}/page`);
    expect(result.title).toBe('Local Test Product');
    expect(result.price).toBe('AED 49,99');
    expect(result.bullets).toEqual(['Free shipping', '2-year warranty']);
    expect(result.suggestedBrief.length).toBeLessThanOrEqual(4000);
    expect(result.supplied).toHaveLength(2);
    expect(result.supplied[0].ref).toBe('product-1');
    expect(result.supplied[0].mime).toBe('image/png');
    expect(Buffer.from(result.supplied[0].data_b64, 'base64').subarray(0, 8).equals(Buffer.from(PNG_SIG))).toBe(true);
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({ width: 10, height: 8 });
  });

  it('rejects hosts outside the allowlist (SSRF bound)', async () => {
    await expect(fetchProductData('https://example.com/item/1')).rejects.toThrow(ProductSourceError);
    await expect(fetchProductData('http://169.254.169.254/latest/meta-data')).rejects.toThrow(ProductSourceError);
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(fetchProductData('ftp://127.0.0.1/x')).rejects.toThrow(ProductSourceError);
    await expect(fetchProductData('file:///etc/passwd')).rejects.toThrow(ProductSourceError);
  });

  it('skips rasters that exceed the per-image cap (honest placeholder path)', async () => {
    const result = await fetchProductData(`${baseUrl}/oversize`);
    // The oversized raster is dropped, but the extraction itself still works.
    expect(result.title).toBe('Oversize Raster Product');
    expect(result.supplied).toHaveLength(0);
    expect(result.images).toHaveLength(0);
  });
});