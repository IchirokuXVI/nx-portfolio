/**
 * Refresh the checked in fixtures from the live storefront (plan 0090, section
 * 10).
 *
 * Run: `npx nx run luna-shopper/carrefour:capture-fixtures`
 *
 * **This is the only thing in this library that launches a browser, and CI
 * never runs it.** Every test reads what it writes, which is what keeps the
 * suite off both the network and Chromium.
 *
 * ## What a fixture is here
 *
 * The page state object, not the HTML. The parser reads
 * `window.__INITIAL_STATE__`, and after hydration the served document no longer
 * carries the literal blob, so a captured copy of the live object is the whole
 * input. It is written **verbatim**: a capture that went through the parser
 * would store what the parser understood rather than what the source sent,
 * which is the one thing a fixture must not do.
 *
 * ## Please do not run it in a loop
 *
 * Every page here is a real request to a live storefront paced at the interval
 * section 5 measured. A refusal means the address is in the escalated state
 * section 4 describes, and running again at once measures the block rather than
 * the site. Wait, then run it again.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CarrefourClient } from '../src/lib/carrefour.client';

const FIXTURES = join(__dirname, '..', 'src', 'lib', '__fixtures__');

/**
 * What each fixture is for. Every one of them carries a case a test asserts on,
 * so a capture that loses one is a capture to redo rather than to commit.
 */
const PAGES: ReadonlyArray<{ name: string; path: string; why: string }> = [
  {
    name: 'listing-page',
    path: '/supermercado/x/cat20003/c?offset=0',
    why: 'a full page of 24 cards, with prices, brands and sizes in the names',
  },
  {
    name: 'listing-over-the-ceiling',
    path: '/supermercado/la-despensa/cat20001/c?offset=0',
    why: 'a category over the ceiling that has children, so the walk descends',
  },
  {
    name: 'product-page',
    path: '/supermercado/cerveza-mahou-clasica-lata-50-cl/R-520661336/p',
    why: 'the EAN a listing card does not carry (section 12.1)',
  },
];

async function main(): Promise<void> {
  mkdirSync(FIXTURES, { recursive: true });
  const client = new CarrefourClient({
    userAgent:
      'LunaShopperBot/1.0 (+https://velista.app; contact: hola@velista.app)',
  });

  let written = 0;
  try {
    for (const page of PAGES) {
      // `readListing` would hand back the parsed form, and the fixture has to
      // be the state itself, so this reaches for the loader the client exposes
      // to exactly this caller.
      const state = await client.captureState(page.path);
      if (!state) {
        console.error(`  !! ${page.name}: no state; ${page.why}`);
        continue;
      }
      writeFileSync(
        join(FIXTURES, `${page.name}.json`),
        JSON.stringify(state),
        'utf8'
      );
      written += 1;
      console.log(`  ok ${page.name}  (${page.why})`);
    }
  } finally {
    await client.close();
  }

  console.log(`\n${written} of ${PAGES.length} fixture(s) written.`);
  if (written < PAGES.length) {
    // A partial capture leaves the suite asserting on a mix of old and new,
    // which is worse than a failure that says so.
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
