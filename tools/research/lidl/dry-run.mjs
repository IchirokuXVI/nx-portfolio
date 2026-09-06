/**
 * Research script. Not production code.
 *
 * A complete LIDL catalog discovery, in the shape the harvester would run it,
 * with nothing written anywhere. It exists to produce the numbers a plan needs:
 * how many requests a run costs, how long it takes, how many products it yields,
 * and how many of those carry an EAN, a price, a size and a validity window.
 *
 * The run has three stages, which is what a real runner would do:
 *   1. list   walk /q/api/search with store=1 and an empty query
 *   2. detail fetch each grocery product page for eans and regionsV2
 *   3. stores read every Spanish store, for the region a price belongs to
 *
 * Usage:
 *   node tools/research/lidl/dry-run.mjs [--limit N] [--skip-detail]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNuxtData } from './nuxt-payload.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const limit = args.includes('--limit')
  ? Number(args[args.indexOf('--limit') + 1])
  : Infinity;
const skipDetail = args.includes('--skip-detail');

const SEARCH = 'https://www.lidl.es/q/api/search';
const STORES =
  'https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores';
const STORES_KEY = '16QaHsGX3Uc3JLhNlS2ZG1CmosbzVPs2';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAUSE_MS = 450;
const PAGE_SIZE = 100;

/**
 * The two categories that are unambiguously supermarket goods. `NonFood` is the
 * weekly middle aisle (tools, lamps, textiles) and `P+F` is plants, so both are
 * out. This matches section 5 of the plan.
 */
const GROCERY = new Set(['Food', 'F+V']);

/**
 * LIDL prices by zone, not by region, and a Spanish postal code decides the zone
 * (see probe-province-price-conflict.mjs). 07 is the Balearics, 35 and 38 are
 * the two Canary provinces, everything else is the mainland.
 */
function zoneForPostalCode(zip) {
  const province = String(zip ?? '')
    .padStart(5, '0')
    .slice(0, 2);
  if (province === '07') return 'BAL';
  if (province === '35' || province === '38') return 'CAN';
  return 'PEN';
}

let requests = 0;
const warnings = [];

async function get(url, headers = {}) {
  requests++;
  const response = await fetch(url, {
    // The search endpoint answers 406 to Accept: application/json. It must be */*.
    headers: {
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'es-ES,es;q=0.9',
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

// ---------------------------------------------------------------- stage 1
async function listInStore() {
  const rows = [];
  let total = null;
  for (let offset = 0; total === null || offset < total; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      assortment: 'ES',
      locale: 'es_ES',
      version: '2.0.0',
      q: '',
      store: '1',
      fetchsize: String(PAGE_SIZE),
      offset: String(offset),
    });
    const body = await (await get(`${SEARCH}?${params}`)).json();
    total ??= body.numFound;
    const boxes = (body.items ?? [])
      .map((i) => i.gridbox?.data)
      .filter(Boolean);
    if (boxes.length === 0) break;
    rows.push(...boxes);
    await pause();
  }
  return { rows, total };
}

// ---------------------------------------------------------------- stage 3
async function listStores() {
  const stores = [];
  const size = 250;
  for (let offset = 0; ; offset += size) {
    const body = await (
      await get(`${STORES}?limit=${size}&offset=${offset}&country_code=ES`, {
        'x-apikey': STORES_KEY,
      })
    ).json();
    stores.push(...body.items);
    if (stores.length >= body.meta.total) break;
    await pause();
  }
  return stores;
}

// ---------------------------------------------------------- observations
/**
 * Turns one product into the per region observations a run would ingest. A
 * region whose price id has no current price is an observation of absence, not
 * a zero, so it is dropped rather than written.
 */
function toObservations(data, detail, observedAt) {
  const regionsV2 = detail?.regionsV2 ?? {};
  const regionsPrices = detail?.regionsPrices ?? data.regionsPrices ?? {};
  const base = {
    externalId: String(data.productId ?? data.itemId),
    name: data.keyfacts?.title ?? data.fullTitle ?? data.title ?? null,
    fullName: data.fullTitle ?? null,
    brand: data.brand?.name ?? detail?.info?.brand?.name ?? null,
    ean: (detail?.eans ?? []).find((e) => String(e).length === 13) ?? null,
    shortCode: (detail?.eans ?? [])[0] ?? null,
    ian: (data.ians ?? [])[0] ?? null,
    sizeFormat: data.price?.packaging?.text ?? null,
    categoryPath: (data.keyfacts?.wonCategoryPrimary ?? '')
      .split('/')
      .filter(Boolean),
    siteCategory: data.category ?? null,
    url: data.canonicalPath ? `https://www.lidl.es${data.canonicalPath}` : null,
    observedAt,
  };

  const byPriceId = new Map();
  for (const [regionId, meta] of Object.entries(regionsV2)) {
    const id = meta.regionPriceId;
    if (!byPriceId.has(id)) byPriceId.set(id, []);
    byPriceId.get(id).push(Number(regionId));
  }
  if (byPriceId.size === 0 && data.price?.price != null) {
    // No detail page was read, so the price is whatever the list showed.
    return [
      {
        ...base,
        regionIds: data.regions ?? [],
        price: data.price.price,
        oldPrice: data.price.oldPrice ?? null,
        validFrom: null,
        validUntil: null,
      },
    ];
  }

  const out = [];
  for (const [priceId, regionIds] of byPriceId) {
    const current = regionsPrices[priceId]?.currentPrice;
    if (!current || current.price == null) continue;
    out.push({
      ...base,
      regionIds,
      price: current.price,
      oldPrice: current.oldPrice ?? null,
      validFrom: current.startDate ?? null,
      validUntil: current.endDate ?? null,
      sizeFormat: current.packaging?.text ?? base.sizeFormat,
    });
  }
  return out;
}

// ------------------------------------------------------------------- run
const startedAt = Date.now();
const observedAt = new Date().toISOString();

console.log('stage 1: listing the in-store assortment');
const { rows, total } = await listInStore();
const grocery = rows.filter((d) =>
  GROCERY.has(String(d.category).split('/')[0])
);
console.log(
  `  in-store products: ${rows.length} of ${total} reported; grocery: ${grocery.length}`
);

console.log('stage 2: reading product pages');
const details = new Map();
const targets = grocery.slice(0, limit === Infinity ? grocery.length : limit);
if (!skipDetail) {
  for (const data of targets) {
    const id = String(data.productId ?? data.itemId);
    try {
      const html = await (
        await get(`https://www.lidl.es${data.canonicalPath}`)
      ).text();
      const root = extractNuxtData(html);
      const detail = root?.pinia?.products?.byId?.[id] ?? null;
      if (detail) details.set(id, detail);
      else warnings.push({ code: 'NO_PAYLOAD', externalId: id });
    } catch (error) {
      warnings.push({
        code: 'DETAIL_FAILED',
        externalId: id,
        message: String(error.message),
      });
    }
    if (details.size % 25 === 0) process.stdout.write('.');
    await pause();
  }
  console.log('');
}
console.log(`  product pages read: ${details.size} of ${targets.length}`);

console.log('stage 3: listing stores');
const stores = await listStores();
const regionStores = new Map();
for (const store of stores) {
  const id = store.marketingData?.offerRegion;
  if (id == null) {
    warnings.push({
      code: 'STORE_WITHOUT_REGION',
      externalId: store.objectNumber,
    });
    continue;
  }
  if (!regionStores.has(id))
    regionStores.set(id, {
      name: store.marketingData.offerRegionName,
      stores: [],
    });
  regionStores.get(id).stores.push(store.objectNumber);
}
console.log(`  stores: ${stores.length}, price regions: ${regionStores.size}`);

const observations = [];
for (const data of targets) {
  const id = String(data.productId ?? data.itemId);
  observations.push(...toObservations(data, details.get(id), observedAt));
}

const seconds = Math.round((Date.now() - startedAt) / 1000);
const products = new Set(observations.map((o) => o.externalId));
const withEan = new Set(
  observations.filter((o) => o.ean).map((o) => o.externalId)
);
const withSize = new Set(
  observations.filter((o) => o.sizeFormat).map((o) => o.externalId)
);
const withWindow = observations.filter((o) => o.validUntil).length;
const multiPriced = [...products].filter(
  (id) =>
    new Set(observations.filter((o) => o.externalId === id).map((o) => o.price))
      .size > 1
);

// Fold the region ids on each observation onto the three zones a price belongs
// to, using the postal codes of the stores in each region. A product that ends
// up with two different prices in one zone is the case the runner must warn on.
const regionZones = new Map();
for (const store of stores) {
  const id = store.marketingData?.offerRegion;
  if (id == null) continue;
  if (!regionZones.has(id)) regionZones.set(id, new Set());
  regionZones.get(id).add(zoneForPostalCode(store.address?.zip));
}
const zonesWritten = new Set();
const priceByProductZone = new Map();
for (const o of observations) {
  for (const regionId of o.regionIds ?? []) {
    for (const zone of regionZones.get(regionId) ?? []) {
      zonesWritten.add(zone);
      const key = `${o.externalId}|${zone}`;
      if (!priceByProductZone.has(key)) priceByProductZone.set(key, new Set());
      priceByProductZone.get(key).add(o.price);
    }
  }
}
const zoneSplits = [...priceByProductZone.entries()].filter(
  ([, prices]) => prices.size > 1
);
// A region whose stores fall in more than one zone would break the whole model.
const regionsCrossingZones = [...regionZones.entries()].filter(
  ([, zones]) => zones.size > 1
);

const report = {
  observedAt,
  seconds,
  requests,
  inStoreListed: rows.length,
  inStoreReported: total,
  groceryProducts: grocery.length,
  detailPagesRead: details.size,
  stores: stores.length,
  priceRegions: regionStores.size,
  observations: observations.length,
  distinctProducts: products.size,
  productsWithEan13: withEan.size,
  productsWithSize: withSize.size,
  observationsWithValidUntil: withWindow,
  productsWithTwoDifferentRealPrices: multiPriced.length,
  zonesWritten: [...zonesWritten].sort(),
  productZonePairsPriced: priceByProductZone.size,
  zoneSplits: zoneSplits.length,
  regionsCrossingZones: regionsCrossingZones.length,
  warnings,
};

writeFileSync(
  join(outDir, 'dry-run.report.json'),
  JSON.stringify(report, null, 2)
);
writeFileSync(
  join(outDir, 'dry-run.observations.json'),
  JSON.stringify(observations, null, 2)
);
writeFileSync(
  join(outDir, 'dry-run.regions.json'),
  JSON.stringify(
    [...regionStores.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      stores: r.stores.length,
    })),
    null,
    2
  )
);

console.log('\n=== dry run report');
for (const [key, value] of Object.entries(report)) {
  if (key === 'warnings') console.log(`  warnings: ${warnings.length}`);
  else console.log(`  ${key}: ${value}`);
}
console.log('\nfirst three observations:');
console.log(JSON.stringify(observations.slice(0, 3), null, 1));
