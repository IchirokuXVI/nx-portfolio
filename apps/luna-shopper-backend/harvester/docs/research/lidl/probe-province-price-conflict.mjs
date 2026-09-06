/**
 * Research script. Not production code.
 *
 * Twelve Spanish provinces hold stores in more than one LIDL offer region. That
 * only matters if those regions charge different prices. This probe reads a
 * sample of product pages and asks, for every province, whether the regions
 * inside it ever disagree on the price of the same product.
 *
 * The answer this week is that they never disagree, and that is a measurement of
 * one week's offers, not a property of the source. The format gives every one of
 * the 59 regions its own price pointer, so read this report as "how much variation
 * is in the data today", never as "how much variation the chain can publish".
 * `priceSplitShapes` is the line that matters, and every split it found was the
 * same shape: a price for 50 provinces and none for the two Canary ones.
 *
 * Usage:
 *   node tools/research/lidl/probe-province-price-conflict.mjs [count]
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
const count = Number(process.argv[2]) || 60;
const GROCERY = new Set(['Food', 'F+V']);

// Which regions sit in which province, and how many stores each region holds.
const { rows: storeRows } = JSON.parse(
  readFileSync(join(outDir, 'postal-to-region.detail.json'), 'utf8')
);
const provinceRegions = new Map();
const regionStoreCount = new Map();
const regionName = new Map();
for (const s of storeRows) {
  if (!provinceRegions.has(s.province))
    provinceRegions.set(s.province, new Set());
  provinceRegions.get(s.province).add(s.regionId);
  regionStoreCount.set(s.regionId, (regionStoreCount.get(s.regionId) ?? 0) + 1);
  regionName.set(s.regionId, s.regionName);
}
const provinceStoreCount = new Map();
for (const s of storeRows) {
  provinceStoreCount.set(
    s.province,
    (provinceStoreCount.get(s.province) ?? 0) + 1
  );
}

const walked = JSON.parse(
  readFileSync(join(outDir, 'assortment-instore.json'), 'utf8')
);
const grocery = walked.filter(
  (r) => GROCERY.has(String(r.category).split('/')[0]) && r.url
);
const step = Math.max(1, Math.floor(grocery.length / count));
const sample = grocery.filter((_, i) => i % step === 0).slice(0, count);
console.log(`grocery rows: ${grocery.length}, sampling ${sample.length}`);

/** province -> how many sampled products priced its regions differently */
const conflicts = new Map();
const examples = [];
/** For a product whose price is not the same everywhere, which provinces pay what. */
const priceSplits = [];
let read = 0;
let multiPriced = 0;

for (const row of sample) {
  let product = null;
  try {
    const response = await fetch(`https://www.lidl.es${row.url}`, {
      headers: {
        'user-agent': UA,
        accept: '*/*',
        'accept-language': 'es-ES,es;q=0.9',
      },
    });
    const root = extractNuxtData(await response.text());
    product = root?.pinia?.products?.byId?.[String(row.productId)] ?? null;
  } catch {
    /* one page failing does not change the answer */
  }
  await new Promise((r) => setTimeout(r, 450));
  if (!product) continue;
  read++;

  const regionsV2 = product.regionsV2 ?? {};
  const regionsPrices = product.regionsPrices ?? {};
  /** region id -> the price that region pays, or null when it has none */
  const priceOf = new Map();
  for (const [regionId, meta] of Object.entries(regionsV2)) {
    priceOf.set(
      Number(regionId),
      regionsPrices[meta.regionPriceId]?.currentPrice?.price ?? null
    );
  }

  // Where the price differences actually fall, grouped by province rather than region.
  const priceByProvince = new Map();
  for (const [province, regions] of provinceRegions) {
    const prices = new Set([...regions].map((id) => priceOf.get(id) ?? null));
    priceByProvince.set(province, [...prices]);
  }
  const allPrices = new Set(
    [...priceByProvince.values()].flat().map((p) => JSON.stringify(p))
  );
  if (allPrices.size > 1) {
    multiPriced++;
    const groups = new Map();
    for (const [province, prices] of priceByProvince) {
      const key = JSON.stringify(prices.sort());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(province);
    }
    priceSplits.push({
      productId: row.productId,
      title: row.title,
      groups: [...groups.entries()].map(([price, provinces]) => ({
        price: JSON.parse(price),
        provinces: provinces.sort(),
      })),
    });
  }

  for (const [province, regions] of provinceRegions) {
    if (regions.size < 2) continue;
    const seen = [...regions].map((id) => ({ id, price: priceOf.get(id) }));
    const distinct = new Set(seen.map((s) => JSON.stringify(s.price)));
    if (distinct.size > 1) {
      conflicts.set(province, (conflicts.get(province) ?? 0) + 1);
      if (examples.length < 12) {
        examples.push({
          province,
          product: row.title,
          productId: row.productId,
          regions: seen.map(
            (s) => `${s.id}=${regionName.get(s.id)}:${s.price ?? 'none'}`
          ),
        });
      }
    }
  }
  process.stdout.write('.');
}
console.log('');

const splitProvinces = [...provinceRegions.entries()].filter(
  ([, r]) => r.size > 1
);
const conflicting = splitProvinces.filter(([p]) => (conflicts.get(p) ?? 0) > 0);
const agreeing = splitProvinces.filter(([p]) => (conflicts.get(p) ?? 0) === 0);

const storesInConflict = conflicting.reduce(
  (n, [p]) => n + provinceStoreCount.get(p),
  0
);
const totalStores = storeRows.length;

const report = {
  productsRead: read,
  provincesTotal: provinceRegions.size,
  provincesSplitAcrossRegions: splitProvinces.length,
  provincesWhereRegionsDisagreeOnPrice: conflicting.length,
  storesInDisagreeingProvinces: storesInConflict,
  totalStores,
  shareOfStoresAPostalCodeRuleWouldRisk: Number(
    ((storesInConflict / totalStores) * 100).toFixed(1)
  ),
  perProvince: splitProvinces.map(([p, r]) => ({
    province: p,
    stores: provinceStoreCount.get(p),
    regions: [...r].map((id) => `${id}=${regionName.get(id)}`),
    productsWithADisagreement: conflicts.get(p) ?? 0,
  })),
  productsWhosePriceIsNotTheSameEverywhere: multiPriced,
  examples,
  // Every split has the same shape, so a handful says as much as the whole list.
  priceSplitSample: priceSplits.slice(0, 5),
  priceSplitShapes: [
    ...priceSplits
      .reduce((acc, s) => {
        const shape = s.groups
          .map(
            (g) =>
              `${g.price.some((p) => p !== null) ? 'price' : 'none'}:${g.provinces.length}`
          )
          .sort()
          .join(' + ');
        acc.set(shape, (acc.get(shape) ?? 0) + 1);
        return acc;
      }, new Map())
      .entries(),
  ].map(([shape, count]) => ({ shape, count })),
};
writeFileSync(
  join(outDir, 'province-price-conflict.json'),
  JSON.stringify(report, null, 2)
);

console.log(`\nproducts read: ${read}`);
console.log(
  `provinces holding more than one region: ${splitProvinces.length} of ${provinceRegions.size}`
);
console.log(
  `of those, provinces whose regions ever disagree on a price: ${conflicting.length}`
);
console.log(
  `  disagreeing: ${conflicting.map(([p]) => p).join(', ') || 'none'}`
);
console.log(
  `  never disagreed in this sample: ${agreeing.map(([p]) => p).join(', ') || 'none'}`
);
console.log(
  `\nstores in a province whose regions disagree: ${storesInConflict} of ${totalStores} ` +
    `(${report.shareOfStoresAPostalCodeRuleWouldRisk}%)`
);
console.log('\nexamples of a province disagreeing with itself:');
for (const e of examples)
  console.log(`  ${e.province}  ${e.product}: ${e.regions.join(' | ')}`);

console.log(
  `\nproducts whose price is not the same everywhere: ${multiPriced} of ${read}`
);
console.log('where those differences fall, by province:');
for (const s of priceSplits.slice(0, 10)) {
  console.log(`  ${s.title}`);
  for (const g of s.groups) {
    console.log(
      `    ${JSON.stringify(g.price)}  <- ${g.provinces.length} provinces: ${g.provinces.join(',')}`
    );
  }
}
