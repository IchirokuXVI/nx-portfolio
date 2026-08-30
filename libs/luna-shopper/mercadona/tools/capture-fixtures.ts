/**
 * Refresh the checked in Mercadona fixtures from the live API (plan 0038,
 * section 9).
 *
 * Run by hand, never by CI:
 *
 *   npx nx run luna-shopper/mercadona:capture-fixtures
 *
 * It makes real requests to a third party, one at a time and paced, so it obeys
 * the same politeness rules the runtime does (section 8.1): one honest
 * User-Agent naming a contact address, a low fixed rate, and a small fixed list
 * of products rather than a crawl. The whole run is fewer than a dozen requests.
 *
 * Every product below is here because a test needs that exact shape. Changing the
 * list means changing what the tests can prove, so add rather than replace.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MercadonaClient } from '../src/lib/mercadona.client';

const OUT_DIR = join(__dirname, '..', 'src', 'lib', '__fixtures__');

const USER_AGENT =
  process.env['HARVEST_USER_AGENT'] ??
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

/** Córdoba, which resolves to warehouse 4661 (section 2.2). */
const POSTAL_CODE = process.env['MERCADONA_POSTAL_CODE'] ?? '14013';

/** file name -> the product whose shape that fixture exists to pin. */
const PRODUCTS: Array<{ file: string; id: string; lang: 'es' | 'en'; why: string }> =
  [
    {
      file: 'product-detail-es.json',
      id: '4241',
      lang: 'es',
      why: 'the ordinary product, with EAN and brand',
    },
    {
      file: 'product-detail-en.json',
      id: '4241',
      lang: 'en',
      why: 'the same product in English (section 2.3)',
    },
  ];

async function main(): Promise<void> {
  const warehouse = await MercadonaClient.resolveWarehouse(POSTAL_CODE, {
    userAgent: USER_AGENT,
  });
  process.stdout.write(`postal code ${POSTAL_CODE} -> warehouse ${warehouse}\n`);

  const client = new MercadonaClient({
    warehouse,
    userAgent: USER_AGENT,
    // One request every 250 ms, sequential. Well inside section 6.3's default.
    minIntervalMs: 250,
  });

  const tree = await client.listCategories('es');
  write('categories-tree.json', { results: tree });
  process.stdout.write(`captured ${tree.length} root categories\n`);

  const firstLevelOne = tree[0]?.children[0];
  if (firstLevelOne) {
    const expanded = await client.getProduct(String(firstLevelOne.id));
    write('category-expanded.json', expanded);
  }

  for (const { file, id, lang, why } of PRODUCTS) {
    const payload = await client.getProduct(id, lang);
    if (payload === null) {
      process.stderr.write(
        `product ${id} answered 404 in warehouse ${warehouse}; ` +
          `the fixture for "${why}" was left as it was\n`
      );
      continue;
    }
    write(file, payload);
  }
}

function write(file: string, payload: unknown): void {
  writeFileSync(
    join(OUT_DIR, file),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`wrote ${file}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
