/**
 * Research script. Not production code.
 *
 * The search endpoint gives a list. The product page gives fields the list does
 * not: eans, regionsV2 and the per region price spread. This probe fetches a
 * sample of grocery product pages and measures how usable those fields are,
 * because Luna resolves a product by EAN when it has one and falls back to an
 * admin queue when it does not.
 *
 * Usage:
 *   node tools/research/lidl/probe-pdp-sample.mjs [count]
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
const count = Number(process.argv[2]) || 30;
const GROCERY = new Set(['Food', 'NonFood', 'P+F', 'F+V']);

const walked = JSON.parse(
  readFileSync(join(outDir, 'assortment-instore.json'), 'utf8')
);
const grocery = walked.filter(
  (r) => GROCERY.has(String(r.category).split('/')[0]) && r.url
);
// Spread the sample across the list rather than taking the first N of one aisle.
const step = Math.max(1, Math.floor(grocery.length / count));
const sample = grocery.filter((_, i) => i % step === 0).slice(0, count);

console.log(`grocery rows: ${grocery.length}, sampling ${sample.length}`);

const rows = [];
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
  } catch (error) {
    console.log(`  ${row.productId} fetch failed: ${error.message}`);
  }
  if (!product) {
    rows.push({ ...row, pdp: false });
    continue;
  }
  const regionsV2 = product.regionsV2 ?? {};
  const regionsPrices = product.regionsPrices ?? {};
  const priceIds = [
    ...new Set(Object.values(regionsV2).map((r) => r.regionPriceId)),
  ];
  const prices = priceIds.map(
    (id) => regionsPrices[id]?.currentPrice?.price ?? null
  );
  const eans = product.eans ?? [];
  rows.push({
    productId: row.productId,
    title: row.title,
    category: row.category,
    eans,
    ians: product.ians ?? [],
    eanKind:
      eans.length === 0
        ? 'none'
        : eans.every((e) => String(e).length === 13)
          ? 'ean13'
          : 'short',
    packaging: product.price?.packaging?.text ?? null,
    price: product.price?.price ?? null,
    regionCount: Object.keys(regionsV2).length,
    priceIdCount: priceIds.length,
    distinctPrices: new Set(prices.filter((p) => p != null)).size,
    unpricedRegions: Object.entries(regionsV2).filter(
      ([, meta]) =>
        regionsPrices[meta.regionPriceId]?.currentPrice?.price == null
    ).length,
    startDate: Object.values(regionsPrices)[0]?.currentPrice?.startDate ?? null,
    endDate: Object.values(regionsPrices)[0]?.currentPrice?.endDate ?? null,
    storeFacts: product.storeFacts ?? null,
    wonCategory: product.keyfacts?.wonCategoryPrimary ?? null,
    pdp: true,
  });
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 500));
}
console.log('');

writeFileSync(join(outDir, 'pdp-sample.json'), JSON.stringify(rows, null, 2));

const ok = rows.filter((r) => r.pdp);
const tally = (key) =>
  Object.entries(
    ok.reduce((acc, r) => {
      acc[r[key]] = (acc[r[key]] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

console.log(`\nfetched ${ok.length} of ${sample.length} product pages`);
console.log('ean kind:', tally('eanKind'));
console.log('distinct prices across regions:', tally('distinctPrices'));
console.log('price id count:', tally('priceIdCount'));
console.log('with packaging text:', ok.filter((r) => r.packaging).length);
console.log('with a price:', ok.filter((r) => r.price != null).length);
console.log('with an end date:', ok.filter((r) => r.endDate).length);
console.log(
  'ean13 examples:',
  ok
    .filter((r) => r.eanKind === 'ean13')
    .slice(0, 5)
    .map((r) => `${r.eans[0]} ${r.title}`)
);
console.log(
  'short-code examples:',
  ok
    .filter((r) => r.eanKind === 'short')
    .slice(0, 5)
    .map((r) => `${r.eans[0]} ${r.title}`)
);
