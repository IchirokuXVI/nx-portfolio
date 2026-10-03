/**
 * Refresh the checked in DIA fixtures from the live site (plan 0174, section
 * 11).
 *
 * Run by hand, never by CI:
 *
 *   npx nx run luna-shopper/dia:capture-fixtures
 *
 * It makes real requests to a third party, **one at a time and paced** at one
 * request every 750 ms, which is below the 2 per second the runtime holds
 * (section 10). It reads a fixed list of answers and never crawls: at most 35
 * requests.
 *
 * It sends the browser headers of decision D1 (section 2), because the site
 * refuses every other client. The headers live in `dia.client.ts`.
 *
 * Each answer is written **verbatim**, byte for byte as the server sent it.
 * Nobody edits a fixture by hand. `statuses.json` records the status of each
 * answer, because a 204 and two of the 206 answers mean something and a body
 * alone does not say which it was.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiaClient, type DiaRawResponse } from '../src/lib/dia.client';
import { parseListing } from '../src/lib/listing';
import { parseMenu } from '../src/lib/menu';
import { parseStoreFileUrl } from '../src/lib/stores';
import type { DiaListingRow } from '../src/lib/types';

const OUT_DIR = join(__dirname, '..', 'src', 'lib', '__fixtures__');
const BASE_URL = 'https://www.dia.es';
const API = '/api/v1';
const LISTING = `${API}/plp-back/reduced`;

/** Cola: three pages, plain rows, packs printed as `12 x 330 ml`. */
const PAGED_LEAF = 'L2108';
/** Manzanas y peras: rows sold by weight, printed `800 g aprox.`. */
const WEIGHT_LEAF = 'L2032';
/**
 * Where each price kind of section 4 was seen on 2026-09-29. Promotions move
 * every week, so page 1 of these is read in order until each kind is found,
 * and a kind that none of them holds is reported and not written.
 */
const PRICE_KIND_LEAVES = [
  'L2107',
  'L2202',
  'L2098',
  'L2193',
  'L2046',
  'L2112',
  'L2017',
  'L2282',
  'L2052',
  'L2247',
];

/** A served code that is not the default, a hub, and an unserved one. */
const SERVED_POSTAL_CODE = '08001';
const DEFAULT_POSTAL_CODE = '28041';
const UNSERVED_POSTAL_CODE = '44200';

/** `idTienda` of the three details (section 11). */
const STORE_NORMAL = '1001720';
const STORE_HUB = '1003554';
const STORE_LEAFLET = '1443';

const statuses: Record<string, number> = {};

async function main(): Promise<void> {
  const client = new DiaClient({ minIntervalMs: 750 });
  const get = async (
    file: string,
    path: string,
    init?: { method?: string; body?: string }
  ): Promise<DiaRawResponse> => {
    const response = await client.fetchRaw(path, init);
    write(file, response);
    return response;
  };

  // 1. A fresh session: the anonymous visitor's postal code.
  await get('header-anonymous.json', `${API}/common-aggregator/header-data`);

  // 2. The menu, and the leaves this capture reads by id.
  const menu = parseMenu(
    json(await get('menu.json', `${API}/common-aggregator/menu-data`))
  );
  const pathOf = (id: string): string => {
    const leaf = menu.leaves.find((candidate) => candidate.id === id);
    if (!leaf) {
      throw new Error(`The menu holds no leaf ${id}.`);
    }
    return leaf.path;
  };

  // 3. Two pages of one leaf, its last page, and a page past the end.
  const paged = pathOf(PAGED_LEAF);
  const first = parseListing(
    json(await get('listing-page-1.json', `${LISTING}${paged}`))
  );
  await get('listing-page-2.json', `${LISTING}${paged}?page=2`);
  if (first.totalPages > 2) {
    await get(
      'listing-last-page.json',
      `${LISTING}${paged}?page=${first.totalPages}`
    );
  }
  await get('listing-past-end.json', `${LISTING}${paged}?page=99`);

  // 4. Rows sold by weight.
  await get('listing-weight.json', `${LISTING}${pathOf(WEIGHT_LEAF)}`);

  // 5. One page per price kind of section 4.
  const wanted = new Map<string, (row: DiaListingRow) => boolean>([
    ['club', (row) => row.prices?.isClubPrice === true],
    [
      'promotion',
      (row) =>
        row.prices?.isPromoPrice === true && row.prices.isClubPrice === false,
    ],
    [
      'multibuy',
      (row) =>
        row.prices?.isClubPrice === false &&
        row.prices.isPromoPrice === false &&
        row.promotions.some((promotion) => promotion.onlyClubDia),
    ],
  ]);
  for (const id of PRICE_KIND_LEAVES) {
    if (wanted.size === 0) {
      break;
    }
    const response = await client.fetchRaw(`${LISTING}${pathOf(id)}`);
    const rows = parseListing(json(response)).rows;
    for (const [kind, matches] of [...wanted]) {
      if (rows.some(matches)) {
        write(`listing-${kind}.json`, response);
        wanted.delete(kind);
      }
    }
  }
  for (const kind of wanted.keys()) {
    process.stdout.write(`NOT FOUND: no candidate leaf holds a ${kind} row\n`);
  }

  // 6. The fulfilment store of a served and of an unserved postal code.
  await get(
    'check-service-200.json',
    `${API}/common-aggregator/check-service?postal_code=${DEFAULT_POSTAL_CODE}`
  );
  await get(
    'check-service-206.txt',
    `${API}/common-aggregator/check-service?postal_code=${UNSERVED_POSTAL_CODE}`
  );

  // 7. A session moved to a served code, then refused an unserved one. The
  //    refusal keeps the code the session had (section 3.4).
  await get(
    'save-shipping-address-204.txt',
    `${API}/common-aggregator/save-shipping-address?new_postal_code=${SERVED_POSTAL_CODE}`,
    { method: 'PUT', body: 'null' }
  );
  await get('header-after-put.json', `${API}/common-aggregator/header-data`);
  await get(
    'save-shipping-address-206.json',
    `${API}/common-aggregator/save-shipping-address?new_postal_code=${UNSERVED_POSTAL_CODE}`,
    { method: 'PUT', body: 'null' }
  );
  await get(
    'header-after-refusal.json',
    `${API}/common-aggregator/header-data`
  );

  // 8. The shop file, named by the store finder page, and three details.
  const page = await get(
    'store-finder.html',
    '/tiendas/buscador-tiendas-folletos'
  );
  const fileUrl = parseStoreFileUrl(
    Buffer.from(page.bytes).toString('utf8'),
    BASE_URL
  );
  if (!fileUrl) {
    throw new Error('The store finder page names no shop file.');
  }
  await get('stores.json.gz', fileUrl);
  const detail = (id: string): string =>
    `/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id=${id}`;
  await get('store-detail-normal.json', detail(STORE_NORMAL));
  await get('store-detail-hub.json', detail(STORE_HUB));
  await get('store-detail-leaflet.json', detail(STORE_LEAFLET));

  writeFileSync(
    join(OUT_DIR, 'statuses.json'),
    `${JSON.stringify(statuses, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`${client.requests} requests\n`);
}

function json(response: DiaRawResponse): unknown {
  return JSON.parse(Buffer.from(response.bytes).toString('utf8'));
}

function write(file: string, response: DiaRawResponse): void {
  writeFileSync(join(OUT_DIR, file), response.bytes);
  statuses[file] = response.status;
  process.stdout.write(
    `wrote ${file} (${response.status}, ${response.bytes.length} bytes)\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
