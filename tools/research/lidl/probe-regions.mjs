/**
 * Research script. Not production code.
 *
 * A LIDL price is not always national. Each product carries regionsPrices, keyed
 * by a price id, and regionsV2, which maps a region id to that price id and to a
 * province name. Each store carries marketingData.offerRegion. This probe proves
 * the two id spaces are the same one, and measures how often a product actually
 * costs different amounts in different regions.
 *
 * Usage:
 *   node tools/research/lidl/probe-regions.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNuxtData } from './nuxt-payload.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STORES_API =
  'https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores';
// Shipped in the public store-search bundle, the same key a browser sends.
const STORES_KEY = '16QaHsGX3Uc3JLhNlS2ZG1CmosbzVPs2';

async function text(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*', ...headers },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

/** Every Spanish store, with the price region each one belongs to. */
async function loadStores() {
  const stores = [];
  const limit = 250;
  for (let offset = 0; ; offset += limit) {
    const body = JSON.parse(
      await text(
        `${STORES_API}?limit=${limit}&offset=${offset}&country_code=ES`,
        { 'x-apikey': STORES_KEY }
      )
    );
    stores.push(...body.items);
    if (stores.length >= body.meta.total) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return stores;
}

/** The product record the detail page renders, which carries regionsV2. */
async function loadProduct(path, productId) {
  const html = await text(`https://www.lidl.es${path}`);
  const root = extractNuxtData(html);
  return root?.pinia?.products?.byId?.[String(productId)] ?? null;
}

const walked = JSON.parse(
  readFileSync(join(outDir, 'assortment-instore.json'), 'utf8')
);
const multi = walked
  .filter((r) => r.category === 'Food' && r.regionPriceCount > 1)
  .slice(0, 4);
const single = walked
  .filter(
    (r) => r.category === 'Food' && r.regionPriceCount === 1 && r.price != null
  )
  .slice(0, 2);

console.log('loading every Spanish store...');
const stores = await loadStores();
const regionsFromStores = new Map();
for (const store of stores) {
  const id = store.marketingData?.offerRegion;
  if (id == null) continue;
  if (!regionsFromStores.has(id))
    regionsFromStores.set(id, {
      name: store.marketingData.offerRegionName,
      stores: 0,
    });
  regionsFromStores.get(id).stores++;
}
console.log(
  `stores: ${stores.length}, distinct offerRegion ids: ${regionsFromStores.size}`
);
console.log(
  'zones:',
  [
    ...new Set(
      stores.map((s) => `${s.marketingData?.zone}/${s.marketingData?.zoneName}`)
    ),
  ].join(', ')
);

const report = {
  storeCount: stores.length,
  regions: [...regionsFromStores.entries()],
  products: [],
};

for (const row of [...multi, ...single]) {
  const product = await loadProduct(row.url, row.productId);
  if (!product) {
    console.log(`\n${row.title}: no payload`);
    continue;
  }
  const regionsV2 = product.regionsV2 ?? {};
  const regionsPrices = product.regionsPrices ?? {};
  const byPriceId = new Map();
  for (const [regionId, meta] of Object.entries(regionsV2)) {
    const priceId = meta.regionPriceId;
    if (!byPriceId.has(priceId)) byPriceId.set(priceId, []);
    byPriceId
      .get(priceId)
      .push({ regionId: Number(regionId), name: meta.regionName });
  }
  console.log(`\n### ${row.title}  (${row.productId})`);
  console.log(
    `    eans=${JSON.stringify(product.eans)} ians=${JSON.stringify(product.ians)}`
  );
  const entry = {
    productId: row.productId,
    title: row.title,
    eans: product.eans,
    ians: product.ians,
    prices: [],
  };
  for (const [priceId, regions] of byPriceId) {
    const current = regionsPrices[priceId]?.currentPrice;
    const storeCount = regions.reduce(
      (n, r) => n + (regionsFromStores.get(r.regionId)?.stores ?? 0),
      0
    );
    const known = regions.filter((r) =>
      regionsFromStores.has(r.regionId)
    ).length;
    console.log(
      `    priceId ${priceId}: ${current?.price ?? 'no price'} EUR  ${current?.packaging?.text ?? ''}  ` +
        `valid ${current?.startDate ?? '?'} .. ${current?.endDate ?? '?'}`
    );
    console.log(
      `      ${regions.length} regions (${known} matched to stores, ${storeCount} stores): ` +
        regions
          .slice(0, 8)
          .map((r) => `${r.regionId}=${r.name}`)
          .join(', ') +
        (regions.length > 8 ? ' ...' : '')
    );
    entry.prices.push({
      priceId,
      price: current?.price ?? null,
      startDate: current?.startDate ?? null,
      endDate: current?.endDate ?? null,
      regionIds: regions.map((r) => r.regionId),
      matchedRegions: known,
      storeCount,
    });
  }
  report.products.push(entry);
  await new Promise((r) => setTimeout(r, 600));
}

writeFileSync(join(outDir, 'regions.json'), JSON.stringify(report, null, 2));
console.log(`\nwritten: ${join(outDir, 'regions.json')}`);
