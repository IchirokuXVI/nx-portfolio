/**
 * Refresh the checked in DEZA fixtures from the live site (plan 0085, section
 * 11).
 *
 * Run by hand, never by CI:
 *
 *   npx nx run luna-shopper/deza:capture-fixtures
 *
 * It makes real requests to a third party, **one at a time and paced**, so it
 * obeys the same politeness rules the runtime does (plan 0038, section 8.1): one
 * honest User-Agent naming a contact address, a low fixed rate, and a fixed list
 * of four pages rather than a crawl.
 *
 * Each page below is here because a test needs that exact shape, and each is
 * written **verbatim**, byte for byte as the server sent it. Nobody edits a
 * fixture by hand: a trimmed page stops proving that the parser can find its
 * containers in a real one, which is most of what these files are for.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEZA_PRODUCTS_PATH, DezaClient } from '../src/lib/deza.client';

const OUT_DIR = join(__dirname, '..', 'src', 'lib', '__fixtures__');

const USER_AGENT =
  process.env['HARVEST_USER_AGENT'] ??
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

/** Bolleria. Small enough that one search inside it fits on a single page. */
const SEARCH_SECTION = 'W051000001';
const SEARCH_TERM = 'croissant';

async function main(): Promise<void> {
  // One request every 500 ms, sequential: a quarter of the rate the DEZA source
  // row ships with, for a capture that is a handful of requests.
  const options = { userAgent: USER_AGENT, minIntervalMs: 500 };

  // 1. The landing page: the section tree, 15 rows, the 20 page widget, the
  //    attribute icons, and a product carried by fewer than ten shops.
  const landing = new DezaClient(options);
  write('landing-page.html', await landing.fetchDocument());

  // 2. A query that fits on one page, so the widget is absent and the last page
  //    number is 0 rather than 1.
  const search = new DezaClient(options);
  write(
    'search-one-page.html',
    await search.fetchDocument({
      section: SEARCH_SECTION,
      terms: [SEARCH_TERM],
    })
  );

  // 3. A page past the end of a capped query: 200, the grid container present,
  //    and nothing in it.
  const past = new DezaClient(options);
  await past.openQuery({ section: SEARCH_SECTION });
  write(
    'page-past-the-end.html',
    await past.fetchDocument(`${DEZA_PRODUCTS_PATH}?wpdz-pagination=1&paged=21`)
  );
}

function write(file: string, payload: string): void {
  writeFileSync(join(OUT_DIR, file), payload, 'utf8');
  process.stdout.write(`wrote ${file} (${payload.length} chars)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
