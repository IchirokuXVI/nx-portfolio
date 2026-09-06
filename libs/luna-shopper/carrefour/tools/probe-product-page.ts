/**
 * Read one Carrefour product page and report what it adds over the listing card.
 *
 * Run: npx tsx libs/luna-shopper/carrefour/tools/probe-product-page.ts <productPath>
 *   npx tsx libs/luna-shopper/carrefour/tools/probe-product-page.ts \
 *     /supermercado/gazpacho-carrefour-sin-gluten-1-l/805505583/p
 *
 * This decides the cost of a run. A listing page carries 24 cards, so reading the
 * assortment from listings alone is one page load per 24 products. Opening every
 * product page multiplies the crawl by 24, which at the pace the storefront tolerates
 * is the difference between a run of hours and a run of days.
 *
 * So the question is not whether a product page holds more, which it plainly does. It
 * is whether it holds anything the catalog needs. The field the catalog wants most is
 * the EAN, because that is what makes a product from one chain the same product as one
 * from another. Whether it is there is what this script reports.
 */

import { writeFileSync } from 'node:fs';
import { CarrefourBrowser, ORIGIN } from './carrefour-browser';

/** Key names anywhere in the state that would matter to the catalog. */
const INTERESTING = [
  'ean',
  'gtin',
  'barcode',
  'nutrition',
  'nutritional',
  'ingredient',
  'ingrediente',
  'allergen',
  'alergeno',
  'origin',
  'origen',
  'brand',
  'marca',
  'weight',
  'peso',
  'format',
  'formato',
  'description',
  'descripcion',
];

/** Walk the whole state and record every path whose leaf is a scalar. */
function collectPaths(
  node: unknown,
  prefix: string,
  out: Map<string, unknown>
): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.slice(0, 3).forEach((v, i) => collectPaths(v, `${prefix}[${i}]`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      collectPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  out.set(prefix, node);
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: probe-product-page.ts <productPath>');
    process.exit(2);
  }

  console.log(`# ${ORIGIN}${path}  (${new Date().toISOString()})`);

  const browser = await CarrefourBrowser.open();
  try {
    const state = await browser.state(path);
    if (!state) {
      console.log('no answer, or the page carries no state blob');
      return;
    }

    console.log('\n## top level state keys\n');
    console.log(Object.keys(state).join(', '));

    const paths = new Map<string, unknown>();
    collectPaths(state, '', paths);
    console.log(`\n## ${paths.size} scalar paths in the state`);

    console.log('\n## paths whose name matches something the catalog wants\n');
    let hits = 0;
    for (const [p, v] of paths) {
      const lower = p.toLowerCase();
      if (!INTERESTING.some((k) => lower.includes(k))) continue;
      const text = String(v).slice(0, 100);
      if (text.length === 0) continue;
      console.log(`  ${p}`);
      console.log(`      ${text}`);
      if (++hits > 60) {
        console.log('  ...');
        break;
      }
    }
    if (hits === 0) console.log('  none');

    // A 13 digit run is what an EAN-13 looks like. Report any, wherever it sits.
    console.log('\n## 13 digit runs anywhere in the state\n');
    const eans = [...new Set(JSON.stringify(state).match(/\b\d{13}\b/g) ?? [])];
    console.log(eans.length ? `  ${eans.slice(0, 20).join(', ')}` : '  none');

    writeFileSync('product-state.json', JSON.stringify(state, null, 1), 'utf8');
    console.log('\nwrote product-state.json');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
