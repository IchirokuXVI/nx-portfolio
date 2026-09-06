/**
 * Page one Carrefour category and report what a product row actually carries.
 *
 * Run: npx tsx tools/research/carrefour/sample-products.ts <catId> [pages] [--out f.json]
 *   npx tsx tools/research/carrefour/sample-products.ts cat20001 5
 *
 * This answers the question the plan must answer: is a listing card enough to write a
 * source product and a price, or must the harvester open every product page as well?
 * The field census at the end is the evidence.
 *
 * Paging is an `offset` query parameter on the listing URL, in steps of the page size
 * the page reports for itself. Paging past what `pagination.total_results` reports
 * returns an empty item list rather than an error.
 */

import { writeFileSync } from 'node:fs';
import {
  CarrefourBrowser,
  priceToCents,
  type RawProductCard,
} from './carrefour-browser';

/** Every category listing lives under this prefix; the seo slug is cosmetic. */
function listingUrl(catId: string, offset: number): string {
  return `/supermercado/x/${catId}/c?offset=${offset}`;
}

interface Normalized {
  productId: string;
  skuId: string;
  name: string;
  brand: string | null;
  priceCents: number | null;
  pricePerUnitCents: number | null;
  measureUnit: string | null;
  sellPackUnit: number | null;
  imageUrl: string | null;
  productUrl: string | null;
}

/** What a harvester adapter would keep from one card. */
function normalize(card: RawProductCard): Normalized {
  return {
    productId: card.product_id,
    skuId: card.sku_id,
    name: card.name,
    brand: card.brand ?? null,
    priceCents: priceToCents(card.price),
    pricePerUnitCents: priceToCents(card.price_per_unit),
    measureUnit: card.measure_unit ?? null,
    sellPackUnit: card.sell_pack_unit ?? null,
    imageUrl: card.images?.desktop ?? null,
    productUrl: card.url ?? null,
  };
}

async function main(): Promise<void> {
  const catId = process.argv[2] ?? 'cat20001';
  const pages = Number(process.argv[3] ?? 3);
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex > 0 ? process.argv[outIndex + 1] : null;

  console.log(
    `# sampling ${catId}, up to ${pages} pages  (${new Date().toISOString()})`
  );

  const browser = await CarrefourBrowser.open();
  try {
    const first = await browser.listing(listingUrl(catId, 0));
    if (!first) throw new Error(`${catId} did not answer`);

    console.log('');
    console.log(`category            ${first.displayName}`);
    console.log(
      `total_results       ${first.totalResults}   (what the result set holds)`
    );
    console.log(
      `pageable results    ${first.pageableResults}   (what paging will serve)`
    );
    console.log(`page_size           ${first.pageSize}`);
    console.log(`total_pages         ${first.totalPages}`);

    const collected: Normalized[] = [];
    const rawFields = new Map<string, number>();
    const seen = new Set<string>();
    let duplicates = 0;
    let cards = 0;

    for (let page = 0; page < pages; page++) {
      const offset = page * first.pageSize;
      const listing =
        page === 0 ? first : await browser.listing(listingUrl(catId, offset));

      if (!listing) {
        console.log(`offset=${offset}: no answer, stopping`);
        break;
      }
      if (listing.items.length === 0) {
        console.log(`offset=${offset}: empty, stopping`);
        break;
      }

      for (const card of listing.items) {
        cards++;
        for (const key of Object.keys(card)) {
          rawFields.set(key, (rawFields.get(key) ?? 0) + 1);
        }
        const n = normalize(card);
        if (seen.has(n.productId)) {
          duplicates++;
        } else {
          seen.add(n.productId);
          collected.push(n);
        }
      }

      console.log(
        `offset=${String(offset).padStart(5)}  items=${listing.items.length}  unique so far=${collected.length}`
      );
    }

    console.log(`\n## Field census over ${cards} cards\n`);
    for (const [key, count] of [...rawFields.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${key.padEnd(22)} ${count}/${cards}`);
    }

    const noPrice = collected.filter((n) => n.priceCents === null);
    const noBrand = collected.filter((n) => !n.brand);
    const noPpu = collected.filter((n) => n.pricePerUnitCents === null);

    console.log('\n## What is usable\n');
    console.log(`unique products     ${collected.length}`);
    console.log(`duplicate ids       ${duplicates}`);
    console.log(`no price            ${noPrice.length}`);
    console.log(`no price per unit   ${noPpu.length}`);
    console.log(`no brand            ${noBrand.length}`);
    console.log(
      `distinct brands     ${new Set(collected.map((n) => n.brand).filter(Boolean)).size}`
    );
    console.log(
      `distinct units      ${[...new Set(collected.map((n) => n.measureUnit).filter(Boolean))].join(', ')}`
    );

    if (noPrice.length > 0) {
      console.log('\n  cards with no readable price:');
      for (const n of noPrice.slice(0, 10))
        console.log(`    ${n.productId}  ${n.name}`);
    }

    console.log('\n## Three normalized rows\n');
    for (const n of collected.slice(0, 3))
      console.log(JSON.stringify(n, null, 1));

    if (outPath) {
      writeFileSync(outPath, JSON.stringify(collected, null, 1), 'utf8');
      console.log(`\nwrote ${outPath}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
