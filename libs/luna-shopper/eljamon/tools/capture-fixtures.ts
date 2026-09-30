/**
 * Refresh the checked in El Jamón fixtures from the live site (plan 0169,
 * section 10).
 *
 * Run by hand, never by CI:
 *
 *   npx nx run luna-shopper/eljamon:capture-fixtures
 *
 * It makes real requests to a third party, **one at a time and paced**, so it
 * obeys the same politeness rules the runtime does (plan 0038, section 8.1): one
 * honest User-Agent naming a contact address, a low fixed rate, and a fixed list
 * of pages rather than a crawl. Eight requests: the session's two, then six
 * pages.
 *
 * Each page is written **verbatim**, byte for byte as the server sent it.
 * Nobody edits a fixture by hand: a trimmed page stops proving that the parser
 * can find its containers in a real one.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ElJamonClient } from '../src/lib/eljamon.client';
import { parseListingPage } from '../src/lib/listing';

const OUT_DIR = join(__dirname, '..', 'src', 'lib', '__fixtures__');

const USER_AGENT =
  process.env['HARVEST_USER_AGENT'] ??
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

/** Frescos: rows sold by weight, rows on offer, and more than one page. */
const CATEGORY_CODE = '04';

async function main(): Promise<void> {
  // One request every 750 ms, sequential: a third of the rate the source row
  // ships with, for a capture that is a handful of requests.
  const client = new ElJamonClient({
    userAgent: USER_AGENT,
    minIntervalMs: 750,
  });

  // 1. The locator: 368 records, two of them another banner.
  write('stores.html', await client.fetchDocument('locator'));

  // 2. The home page of a session with a postal code: the category menu.
  write('home.html', await client.fetchDocument({ path: '/' }));

  const category = (await client.topCategories()).find(
    (candidate) => candidate.code === CATEGORY_CODE
  );
  if (!category) {
    throw new Error(`The home page lists no category ${CATEGORY_CODE}.`);
  }

  // 3. Page 1 of a category, a GET: the article count and the filters JSON.
  const first = await client.fetchDocument({ path: category.path });
  write('category-page-1.html', first);

  // 4. Page 2 of the same category, the POST of page 1's filters.
  const filters = parseListingPage(first).filters;
  if (!filters) {
    throw new Error('Page 1 carried no filters input.');
  }
  write(
    'category-page-2.html',
    await client.fetchDocument({ category, page: 2, filters })
  );

  // 5. One product page: the JSON-LD with its single quoted availability, and
  //    the breadcrumb.
  const product = parseListingPage(first).rows[0];
  if (!product) {
    throw new Error('Page 1 held no rows.');
  }
  write('product.html', await client.fetchDocument({ path: product.url }));
}

function write(file: string, payload: string): void {
  writeFileSync(join(OUT_DIR, file), payload, 'utf8');
  process.stdout.write(`wrote ${file} (${payload.length} chars)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
