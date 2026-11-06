/**
 * Refresh the checked in fixtures from the live storefront (plan 0090, section
 * 10).
 *
 * Run: `npx nx run luna-shopper/carrefour:capture-fixtures`
 *
 * Names on the command line capture those fixtures alone, so a capture of the
 * store finder does not reload three storefront pages it has no reason to:
 * `npx nx run luna-shopper/carrefour:capture-fixtures --args="store-locator drives"`.
 *
 * **This is the only thing in this library that launches a browser, and CI
 * never runs it.** Every test reads what it writes, which is what keeps the
 * suite off both the network and Chromium.
 *
 * ## What a fixture is here
 *
 * For a storefront page, the page state object, not the HTML. The parser reads
 * `window.__INITIAL_STATE__`, and after hydration the served document no longer
 * carries the literal blob, so a captured copy of the live object is the whole
 * input. It is written **verbatim**: a capture that went through the parser
 * would store what the parser understood rather than what the source sent,
 * which is the one thing a fixture must not do.
 *
 * For the store finder and the drive list (plan 0223), the response body
 * itself, read as text through the same browser and the same cookie rule.
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
import {
  CARREFOUR_DRIVES_PATH,
  CARREFOUR_STORE_LOCATOR_PATH,
} from '../src/lib/types';

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

/**
 * The documents a store run reads, written as the bytes the source sent (plan
 * 0223, sections 2 and 3). Two loads at the 2 s floor.
 */
const DOCUMENTS: ReadonlyArray<{ file: string; path: string; why: string }> = [
  {
    file: 'store-locator.xml',
    path: CARREFOUR_STORE_LOCATOR_PATH,
    why: 'every point of sale, with the formats and the drops the parser names',
  },
  {
    file: 'drives.json',
    path: CARREFOUR_DRIVES_PATH,
    why: 'every online sale point, joined to its shop by position',
  },
];

/** The name a fixture is asked for by: its file name without the extension. */
const nameOf = (file: string): string => file.replace(/\.[^.]+$/, '');

async function main(): Promise<void> {
  const asked = new Set(process.argv.slice(2));
  const wanted = (name: string): boolean => asked.size === 0 || asked.has(name);
  const pages = PAGES.filter((page) => wanted(page.name));
  const documents = DOCUMENTS.filter((document) =>
    wanted(nameOf(document.file))
  );
  const total = pages.length + documents.length;
  if (total === 0) {
    console.error(`No fixture is named ${[...asked].join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(FIXTURES, { recursive: true });
  const client = new CarrefourClient({
    userAgent:
      'LunaShopperBot/1.0 (+https://velista.app; contact: hola@velista.app)',
  });

  let written = 0;
  try {
    for (const page of pages) {
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
    for (const document of documents) {
      const body = await client.captureText(document.path);
      if (body === null) {
        console.error(`  !! ${document.file}: no body; ${document.why}`);
        continue;
      }
      writeFileSync(join(FIXTURES, document.file), body, 'utf8');
      written += 1;
      console.log(`  ok ${document.file}  (${document.why})`);
    }
  } finally {
    await client.close();
  }

  console.log(
    `\n${written} of ${total} fixture(s) written in ${client.loads} load(s).`
  );
  if (written < total) {
    // A partial capture leaves the suite asserting on a mix of old and new,
    // which is worse than a failure that says so.
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
