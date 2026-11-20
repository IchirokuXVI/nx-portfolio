/**
 * Refresh the checked in fixtures from the live site (plan 0089, section 6).
 *
 * Run: `npx nx run luna-shopper/lidl:capture-fixtures`
 *
 * **CI never runs it.** Every test reads what it writes, which is what keeps
 * the suite off the network.
 *
 * ## What a fixture is here
 *
 * The response as served. For the index and the store service that is the JSON
 * body. For a product page it is the flat array inside the page's
 * `__NUXT_DATA__` tag, because the page has no JSON endpoint behind it and that
 * tag is the whole input. It is written **verbatim**: a capture that went
 * through the normalizer would store what the normalizer understood rather than
 * what the source sent, which is the one thing a fixture must not do.
 *
 * ## The assortment is a rolling window, so a product will go missing
 *
 * The site publishes the week's offers, so a product named below leaves in a
 * week or two and its capture then fails by name. **Pick a new product for that
 * case rather than dropping the case**: each one pins a shape the normalizer
 * has to keep reading, and the shapes outlive any week's assortment.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGroceryCategory } from '../src/lib/categories';
import { LidlClient } from '../src/lib/lidl.client';
import { approxWeightIn } from '../src/lib/size';
import type { LidlListRow } from '../src/lib/types';

const FIXTURES = join(__dirname, '..', 'src', 'lib', '__fixtures__');

/**
 * The window the index fixture is taken from.
 *
 * Chosen because it holds grocery rows beside bazar rows, so the coarse
 * category filter of section 5 has something to keep and something to drop. It
 * is a rolling window, so a re-capture lands on a different mix; check that it
 * still holds both before committing one.
 */
const SEARCH_OFFSET = 325;

/** How many index rows the fixture holds. One page of the walk is 100. */
const SEARCH_PAGE_SIZE = 5;

/** What each product fixture is for, and why that product was chosen. */
const PRODUCTS: ReadonlyArray<{ name: string; path: string; why: string }> = [
  {
    name: 'product-single-price',
    path: '/p/vela-aromatica/p11671605',
    why: 'an EAN-13, one priced region group and one the chain prices nothing for',
  },
  {
    name: 'product-two-region-prices',
    path: '/p/parkside-nevera-movil-recargable/p11096990',
    why: 'two region groups with two different prices, which grocery did not show in the week this was captured',
  },
  {
    name: 'product-unpriced',
    path: '/p/oxy-blanco/p11008087',
    why: 'in the window with no current price in any region at all',
  },
  {
    name: 'product-short-code',
    path: '/p/uva-blanca-sabores-sin-semillas/p11029954',
    why: "an eight digit code in `eans`, which is LIDL's own weight item number and never an EAN",
  },
];

/**
 * A case whose product is found in the week's index rather than named, because
 * the shape is rare and the rolling window replaces the product every week.
 * The first grocery row the predicate accepts is captured.
 */
const FOUND: ReadonlyArray<{
  name: string;
  accepts: (row: LidlListRow) => boolean;
  why: string;
}> = [
  {
    name: 'product-approximate-weight',
    // `Aprox. 350 g`, one number: a range states no weight (plan 0244).
    accepts: (row) =>
      isGroceryCategory(row.siteCategory) &&
      approxWeightIn(row.sizeFormat) !== null,
    why: 'a tray printed `Aprox. N g`, a piece priced as one with an approximate weight (plan 0244)',
  },
];

/**
 * How many index rows one request of the search for {@link FOUND} asks for:
 * the page a run walks, so the search sees the window a run sees.
 */
const FIND_PAGE_SIZE = 100;

/**
 * `--only=<name>[,<name>]` captures the named fixtures (file names without
 * `.json`) and leaves every other file as it is. With no `--only` every
 * fixture is refreshed, as before.
 */
const ONLY = readOnly(process.argv.slice(2));

function readOnly(args: string[]): Set<string> | null {
  const names = args
    .filter((arg) => arg.startsWith('--only='))
    .flatMap((arg) => arg.slice('--only='.length).split(','))
    .map((name) => name.trim().replace(/\.json$/, ''))
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function wanted(name: string): boolean {
  return ONLY === null || ONLY.has(name);
}

async function main(): Promise<void> {
  mkdirSync(FIXTURES, { recursive: true });
  const userAgent =
    'LunaShopperBot/1.0 (+https://velista.app; contact: hola@velista.app)';
  const client = new LidlClient({
    userAgent,
    pageSize: SEARCH_PAGE_SIZE,
    // The site is polite to a browser's pace and this tool has no run behind it
    // to hold a token bucket, so it keeps its own floor.
    minIntervalMs: 700,
  });

  let written = 0;
  let planned = 0;

  if (wanted('search-page')) {
    planned += 1;
    const search = await client.captureSearchPage(SEARCH_OFFSET);
    written += write('search-page', search, 'one page of the in-store index');
  }

  for (const product of PRODUCTS) {
    if (!wanted(product.name)) {
      continue;
    }
    planned += 1;
    const payload = await client.captureProductPayload(product.path);
    if (!payload) {
      console.error(`  !! ${product.name}: no payload; ${product.why}`);
      continue;
    }
    written += write(product.name, payload, product.why);
  }

  const found = FOUND.filter((entry) => wanted(entry.name));
  if (found.length > 0) {
    const finder = new LidlClient({
      userAgent,
      pageSize: FIND_PAGE_SIZE,
      minIntervalMs: 700,
    });
    const rows: LidlListRow[] = [];
    for await (const row of finder.walkInStore()) {
      rows.push(row);
    }
    for (const entry of found) {
      planned += 1;
      const row = rows.find((candidate) => entry.accepts(candidate));
      if (!row?.path) {
        console.error(
          `  !! ${entry.name}: no row of this week's ${rows.length} accepts it; ${entry.why}`
        );
        continue;
      }
      console.log(
        `  .. ${entry.name}: ${row.path} prints ${JSON.stringify(row.sizeFormat)}`
      );
      const payload = await client.captureProductPayload(row.path);
      if (!payload) {
        console.error(`  !! ${entry.name}: no payload; ${entry.why}`);
        continue;
      }
      written += write(entry.name, payload, entry.why);
    }
  }

  if (wanted('store-page')) {
    planned += 1;
    const stores = await client.captureStorePage(5);
    written += write(
      'store-page',
      stores,
      'five shops, each naming its price region'
    );
  }

  console.log(`\n${written} of ${planned} fixture(s) written.`);
  if (written < planned) {
    // A partial capture leaves the suite asserting on a mix of old and new,
    // which is worse than a failure that says so.
    process.exitCode = 1;
  }
}

function write(name: string, payload: unknown, why: string): number {
  if (payload === null || payload === undefined) {
    console.error(`  !! ${name}: nothing answered; ${why}`);
    return 0;
  }
  writeFileSync(
    join(FIXTURES, `${name}.json`),
    JSON.stringify(payload),
    'utf8'
  );
  console.log(`  ok ${name}  (${why})`);
  return 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
