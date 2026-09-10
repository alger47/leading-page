/**
 * Published-page performance budget (measured, master prompt §5.7).
 *
 * Run AFTER `next build`. Measures the gzipped client JS a published page
 * actually loads and enforces the ~90 KB budget (excluding images), plus
 * isolation (§5.7: zero dashboard/editor JS on published routes).
 *
 * Measurement basis: the `(published)/[host]` page renders a React client
 * shell (the public ui-components renderer — context requires a client
 * boundary; Server Components cannot use React context). Its browser fetch-set
 * is the standard Next App Router baseline + the page's own thin chunk:
 *   webpack-runtime + framework (React/Next) + main (shared app modules,
 *   includes the public renderer) + main-app (bootstrap) + [host]/page chunk.
 * The legacy-browser `polyfills-*` chunk is conditional and reported
 * separately. Dashboard/editor chunks live in separate lazy chunks
 * (e.g. generation-view, page-editor) and are NOT part of this set; this is
 * verified: the published route's server bundle must not reference any
 * dashboard/editor module.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 90_000; // gzipped, excluding images
const EDITOR_MARKERS = ['page-editor', 'generation-view', 'versions-view', 'publish-view', 'logout-button', 'editor/'];

const root = process.cwd();
const chunksDir = join(root, '.next', 'static', 'chunks');
const publishedServerRoute = join(root, '.next', 'server', 'app', '(published)', '[host]', 'route.js');
const publishedServerPage = join(root, '.next', 'server', 'app', '(published)', '[host]', 'page.js');
const serverBundle = existsSync(publishedServerRoute) ? publishedServerRoute : publishedServerPage;

if (!existsSync(chunksDir)) {
  console.error('published-budget: no build output (.next/static/chunks). Run `pnpm build` first.');
  process.exit(1);
}

const gzipped = (p) => gzipSync(readFileSync(p)).length;
const chunkFiles = readdirSync(chunksDir).filter((f) => f.endsWith('.js'));
const findBy = (re) => chunkFiles.find((f) => re.test(f));

const pageChunkFile = readdirSync(join(chunksDir, 'app', '(published)', '[host]')).find((f) => /^page-[0-9a-f]+\.js$/.test(f));
const fetchSet = [
  ['webpack runtime', findBy(/^webpack-[0-9a-f]+\.js$/)],
  ['framework (React/Next)', findBy(/^framework-[0-9a-f]+\.js$/)],
  ['main (shared app modules + renderer)', findBy(/^main-[0-9a-f]+\.js$/)],
  ['main-app (bootstrap)', findBy(/^main-app-[0-9a-f]+\.js$/)],
  ['(published)/[host] page chunk', pageChunkFile ? join('app', '(published)', '[host]', pageChunkFile) : undefined],
];
const polyfills = findBy(/^polyfills-[0-9a-f]+\.js$/);

let total = 0;
const rows = [];
for (const [label, rel] of fetchSet) {
  if (!rel) continue;
  const bytes = gzipped(join(chunksDir, rel));
  total += bytes;
  rows.push([label, rel, bytes]);
}
const polyBytes = polyfills ? gzipped(join(chunksDir, polyfills)) : 0;

let isolation = true;
let reason = 'server bundle exists';
if (serverBundle && existsSync(serverBundle)) {
  const bundle = readFileSync(serverBundle, 'utf8');
  const leaked = EDITOR_MARKERS.filter((m) => bundle.includes(m));
  if (leaked.length > 0) {
    isolation = false;
    reason = `published route server bundle references dashboard/editor modules: ${leaked.join(', ')}`;
  }
} else {
  isolation = false;
  reason = `published route server bundle not found (tried ${publishedServerRoute})`;
}

const kb = (total / 1024).toFixed(1);
console.log(`published-page client JS (gzipped, measured): ${kb} KB (budget ${(BUDGET_BYTES / 1024).toFixed(1)} KB) -> ${total <= BUDGET_BYTES ? 'OK' : 'OVER BUDGET'}`);
for (const [label, rel, bytes] of rows) console.log(`  ${(bytes / 1024).toFixed(1)} KB gz  ${label} (${rel})`);
if (polyfills) console.log(`  (+${(polyBytes / 1024).toFixed(1)} KB gz legacy polyfills — fetched only by old browsers, excluded above)`);
console.log(`isolation (zero dashboard/editor JS on published route): ${isolation ? 'OK' : 'FAIL'} -> ${reason}`);

if (total > BUDGET_BYTES || !isolation) process.exit(1);