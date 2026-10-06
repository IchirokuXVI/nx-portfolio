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
 * of products rather than a crawl. The whole run is about twenty requests.
 *
 * Every product below is here because a test needs that exact shape. Changing the
 * list means changing what the tests can prove, so add rather than replace.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MERCADONA_BASE_URL,
  MercadonaClient,
} from '../src/lib/mercadona.client';
import {
  MERCADONA_STORES_TOTAL_URL,
  MERCADONA_STORES_URL,
} from '../src/lib/stores';

const OUT_DIR = join(__dirname, '..', 'src', 'lib', '__fixtures__');

const USER_AGENT =
  process.env['HARVEST_USER_AGENT'] ??
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

/** Córdoba, which resolves to warehouse 4661 (section 2.2). */
const POSTAL_CODE = process.env['MERCADONA_POSTAL_CODE'] ?? '14013';

/** file name -> the product whose shape that fixture exists to pin. */
const PRODUCTS: Array<{
  file: string;
  id: string;
  lang: 'es' | 'en';
  why: string;
}> = [
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
  {
    file: 'product-box-of-capsules.json',
    id: '11801',
    lang: 'es',
    why: 'a box priced as one piece that prints how many capsules it holds (plan 0177)',
  },
  {
    file: 'product-pack-of-pads.json',
    id: '16566',
    lang: 'es',
    why: 'a pack of pads sized `1 ud` whose count is in total_units (plan 0183)',
  },
  {
    file: 'product-pack-of-wipes.json',
    id: '47293',
    lang: 'es',
    why: 'a pack of wipes sized `1 ud` whose count is in total_units (plan 0183)',
  },
  {
    file: 'product-single-razor.json',
    id: '22083',
    lang: 'es',
    why: 'a single object sized `1 ud` with no total_units (plan 0183)',
  },
  {
    file: 'product-roll-of-services.json',
    id: '49173',
    lang: 'es',
    why: 'one roll sized `1 ud` whose total_units counts sheets and not pieces (plan 0183)',
  },
  {
    file: 'product-approximate-weight.json',
    id: '50946',
    lang: 'es',
    why: 'a piece of cheese sold by approximate weight, with an in-store barcode (plan 0181)',
  },
  {
    file: 'product-fixed-pack-in-store-barcode.json',
    id: '84692',
    lang: 'es',
    why: 'a fixed pack that also carries an in-store barcode (plan 0181)',
  },
  {
    file: 'product-reference-format-100ml.json',
    id: '46815',
    lang: 'es',
    why: 'a body oil whose reference_format reads `100 ml` (plan 0189)',
  },
  {
    file: 'product-reference-format-100g.json',
    id: '34149',
    lang: 'es',
    why: 'a ground spice whose reference_format reads `100 g` (plan 0189)',
  },
  {
    file: 'product-eggs-per-dozen.json',
    id: '15768',
    lang: 'es',
    why: 'a dozen eggs whose reference_format reads `dc` (plan 0189)',
  },
  {
    file: 'product-detergent-per-wash.json',
    id: '86400',
    lang: 'es',
    why: 'a detergent whose reference_format reads `lv`, a wash (plan 0189)',
  },
];

/**
 * file name -> the category whose listing that fixture pins, as the walk
 * fetches it: `GET /categories/<id>/`, the products inline with their price
 * block and no `ean`.
 */
const LISTINGS: Array<{ file: string; id: string; why: string }> = [
  {
    file: 'category-listing-cheese.json',
    id: '54',
    why: 'a listing that carries approx_size, holding product 50946 (plan 0181)',
  },
];

async function main(): Promise<void> {
  await captureStores();

  const warehouse = await MercadonaClient.resolveWarehouse(POSTAL_CODE, {
    userAgent: USER_AGENT,
  });
  if (warehouse === null) {
    throw new Error(
      `Mercadona sells online to nobody at postal code ${POSTAL_CODE}, so ` +
        'there is no warehouse to capture the product fixtures from. Set ' +
        'MERCADONA_POSTAL_CODE to a code the chain serves.'
    );
  }
  process.stdout.write(
    `postal code ${POSTAL_CODE} -> warehouse ${warehouse}\n`
  );

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

  for (const { file, id, why } of LISTINGS) {
    // The same pacing the client keeps, on the one request it has no raw
    // method for: the client answers a listing already normalized.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const query = new URLSearchParams({ lang: 'es', wh: warehouse });
    const response = await fetch(
      `${MERCADONA_BASE_URL}/categories/${id}/?${query.toString()}`,
      { headers: { accept: 'application/json', 'user-agent': USER_AGENT } }
    );
    if (!response.ok) {
      process.stderr.write(
        `category ${id} answered ${response.status} in warehouse ${warehouse}; ` +
          `the fixture for "${why}" was left as it was\n`
      );
      continue;
    }
    write(file, await response.json());
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

/**
 * The store finder's two documents, verbatim (plan 0106, section 2).
 *
 * Written as text and not re-serialized: `data.js` is a JavaScript assignment
 * rather than JSON, and the parser exists to strip exactly that assignment, so a
 * fixture that had already been through `JSON.parse` would prove nothing about
 * the shape the source actually sends.
 */
async function captureStores(): Promise<void> {
  for (const [file, url] of [
    ['stores.js', MERCADONA_STORES_URL],
    ['stores-total.js', MERCADONA_STORES_TOTAL_URL],
  ] as const) {
    const response = await fetch(url, {
      headers: { accept: '*/*', 'user-agent': USER_AGENT },
    });
    if (!response.ok) {
      process.stderr.write(
        `${url} answered ${response.status}; ${file} was left as it was\n`
      );
      continue;
    }
    const body = await response.text();
    writeFileSync(join(OUT_DIR, file), body, 'utf8');
    process.stdout.write(`wrote ${file} (${body.length} bytes)\n`);
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
