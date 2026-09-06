/**
 * Research script. Not production code.
 *
 * Walks the whole in-store assortment through /q/api/search and writes what it
 * finds, so we can measure three things a plan needs to state: how many
 * products the endpoint reaches, how deep the paging goes before it stops, and
 * which fields are present on a real supermarket product.
 *
 * store=1 is the in-store filter. An empty q returns the whole assortment.
 *
 * Usage:
 *   node tools/research/lidl/walk-assortment.mjs [--all] [--page 36]
 *     --all   drop store=1 and walk the online shop too
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const inStoreOnly = !args.includes('--all');
const pageSize = Number(args[args.indexOf('--page') + 1]) || 36;

const BASE = 'https://www.lidl.es/q/api/search';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAUSE_MS = 500;

async function page(offset) {
  const params = new URLSearchParams({
    assortment: 'ES',
    locale: 'es_ES',
    version: '2.0.0',
    q: '',
    fetchsize: String(pageSize),
    offset: String(offset),
  });
  if (inStoreOnly) params.set('store', '1');
  const url = `${BASE}?${params}`;
  const response = await fetch(url, {
    // The endpoint answers 406 to Accept: application/json. It must be */*.
    headers: {
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'es-ES,es;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`${response.status} at offset ${offset}`);
  return response.json();
}

/** Reduces a gridbox to the fields a harvest observation would keep. */
function toObservation(box) {
  const d = box?.data;
  if (!d) return null;
  const regionsPrices = d.regionsPrices ?? {};
  const regionIds = Object.keys(regionsPrices);
  const sample = regionIds.length
    ? regionsPrices[regionIds[0]]?.currentPrice
    : null;
  return {
    productId: d.productId ?? d.itemId ?? null,
    erpNumber: d.erpNumber ?? null,
    ians: d.ians ?? [],
    nat: d.nat ?? null,
    title: d.fullTitle ?? d.title ?? null,
    brand: d.brand?.name ?? null,
    category: d.category ?? null,
    wonCategory: d.keyfacts?.wonCategoryPrimary ?? null,
    wonCategoryPath: d.keyfacts?.wonCategoryPrimaryPath ?? null,
    productType: d.productType ?? null,
    online: d.online ?? null,
    store: d.store ?? null,
    badges: (d.stockAvailability?.badgeInfo?.badges ?? []).map((b) => b.type),
    url: d.canonicalPath ?? null,
    packaging: d.price?.packaging?.text ?? null,
    price: d.price?.price ?? null,
    oldPrice: d.price?.oldPrice ?? null,
    basePrice: d.price?.basePrice ?? null,
    discountText: d.price?.discount?.discountText ?? null,
    regionCount: (d.regions ?? []).length,
    regionPriceCount: regionIds.length,
    regionPriceEndDate: sample?.endDate ?? null,
    regionPriceDistinct: [
      ...new Set(regionIds.map((id) => regionsPrices[id]?.currentPrice?.price)),
    ].length,
    hasPrice: d.havingPrice ?? null,
  };
}

const seen = new Map();
let numFound = null;
let offset = 0;
let pages = 0;
let stoppedBecause = 'reached numFound';

while (true) {
  let body;
  try {
    body = await page(offset);
  } catch (error) {
    stoppedBecause = `error: ${error.message}`;
    break;
  }
  pages++;
  numFound ??= body.numFound;
  const boxes = (body.items ?? []).map((i) => i.gridbox).filter(Boolean);
  if (boxes.length === 0) {
    stoppedBecause = `empty page at offset ${offset}`;
    break;
  }
  let added = 0;
  for (const box of boxes) {
    const obs = toObservation(box);
    if (!obs?.productId) continue;
    if (!seen.has(obs.productId)) added++;
    seen.set(obs.productId, obs);
  }
  console.log(
    `offset ${String(offset).padStart(5)}  page ${boxes.length}  new ${added}  total ${seen.size}/${numFound}`
  );
  offset += pageSize;
  if (offset >= numFound) break;
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
}

const rows = [...seen.values()];
const name = inStoreOnly ? 'assortment-instore' : 'assortment-all';
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows, null, 2));

const counts = (key) =>
  Object.entries(
    rows.reduce((acc, r) => {
      const k = JSON.stringify(r[key]);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

console.log(
  `\nnumFound=${numFound} collected=${rows.length} pages=${pages} stopped: ${stoppedBecause}`
);
console.log('\nproductType:', counts('productType').slice(0, 8));
console.log('category:', counts('category').slice(0, 10));
console.log('badges:', counts('badges').slice(0, 6));
console.log('online:', counts('online'));
console.log('with a price:', rows.filter((r) => r.price != null).length);
console.log(
  'with regionsPrices:',
  rows.filter((r) => r.regionPriceCount > 0).length
);
console.log(
  'regional prices that differ:',
  rows.filter((r) => r.regionPriceDistinct > 1).length
);
console.log(
  'with an EAN-ish ian:',
  rows.filter((r) => r.ians.length > 0).length
);
console.log('with packaging text:', rows.filter((r) => r.packaging).length);
console.log(`\nwritten: ${join(outDir, `${name}.json`)}`);
