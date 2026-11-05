import {
  SourceProbeRecorder,
  belowFloor,
  countingFetch,
  hasText,
  isFiniteNumber,
  isPositive,
  mostRowsCarry,
  pacedAcquire,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import type { Json } from './json';
import { MERCADONA_BASE_URL, MercadonaClient } from './mercadona.client';
import { normalizeProduct } from './normalize';
import { MERCADONA_STORES_URL } from './stores';

/**
 * The postal code the warehouse step asks for. It is the code the live spec
 * has always used, so the probe needs no price scope from catalog.
 */
export const MERCADONA_PROBE_POSTAL_CODE = '14013';

/** 26 roots on the day the client was written. */
const ROOT_FLOOR = 10;
/** 151 level 1 categories under them on the same day. */
const CHILD_FLOOR = 50;
/** 1,675 shops in the store finder's document of 2026-09-11. */
const SHOP_FLOOR = 100;

/** The raw keys the walk rests on. `ean` and `brand` exist only on this page. */
const PRODUCT_KEYS = [
  'id',
  'ean',
  'brand',
  'display_name',
  'price_instructions',
];
const PRICE_KEYS = [
  'unit_price',
  'bulk_price',
  'unit_size',
  'size_format',
  'reference_format',
];

/** What {@link probeMercadona} takes: the seams its client takes. */
export interface MercadonaProbeOptions {
  userAgent: string;
  /** The storefront API. From `mercadonaBaseUrl` in the harvester. */
  baseUrl?: string;
  /** The store finder's documents, from the source row as a store run reads them. */
  storesUrl?: string;
  totalsUrl?: string;
  postalCode?: string;
  /** The run's token bucket at the row's rate. */
  acquire?: () => Promise<void>;
  /** The least time between two requests. Default 1000 ms. */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** The clock a step's duration is read from. */
  now?: () => number;
}

/**
 * Five steps against Mercadona's storefront (plan 0219, section 3.2): the
 * warehouse of a postal code, the category tree, one level 1 listing, the
 * product the listing names first, and the store finder's document with its
 * companion count.
 *
 * Never throws for a source failure. **No retry of anything**: `retries` is 0,
 * so a 403 or a 429 throws at once and the probe makes no request after it.
 */
export async function probeMercadona(
  options: MercadonaProbeOptions
): Promise<SourceProbeResult> {
  const counter = countingFetch(options.fetchImpl ?? fetch);
  const acquire = pacedAcquire({
    acquire: options.acquire,
    minIntervalMs: options.minIntervalMs ?? 1000,
    sleep: options.sleepImpl,
    now: options.now,
  });
  const shared = {
    userAgent: options.userAgent,
    fetchImpl: counter.fetchImpl,
    acquire,
    signal: options.signal,
    sleepImpl: options.sleepImpl,
    retries: 0,
  };
  const base = (options.baseUrl ?? MERCADONA_BASE_URL).replace(/\/+$/, '');
  const postalCode = options.postalCode ?? MERCADONA_PROBE_POSTAL_CODE;
  const probe = new SourceProbeRecorder(options.now);

  const warehouse = await probe.step(
    'warehouse',
    `${base}/postal-codes/actions/change-pc/`,
    () =>
      MercadonaClient.resolveWarehouse(postalCode, {
        ...shared,
        baseUrl: options.baseUrl,
      }),
    (value) => ({
      problems: hasText(value)
        ? []
        : [`postal code ${postalCode} answered no warehouse`],
      sample: { postalCode, warehouse: value },
    })
  );
  if (warehouse === undefined || warehouse === null) {
    return probe.result(counter.count());
  }

  const client = new MercadonaClient({
    ...shared,
    baseUrl: options.baseUrl,
    warehouse,
  });
  const query = `?lang=es&wh=${encodeURIComponent(warehouse)}`;

  const tree = await probe.step(
    'categories',
    `${base}/categories/${query}`,
    () => client.listCategories('es'),
    (roots) => {
      const children = roots.flatMap((root) => root.children);
      return {
        problems: [
          ...belowFloor(roots.length, ROOT_FLOOR, 'roots'),
          ...belowFloor(children.length, CHILD_FLOOR, 'level 1 categories'),
        ],
        sample: {
          roots: roots.length,
          children: children.length,
          firstChild: children[0]?.name ?? null,
        },
      };
    }
  );
  const first = tree?.flatMap((root) => root.children)[0];
  if (!first) {
    return probe.result(counter.count());
  }

  const listing = await probe.step(
    'listing',
    `${base}/categories/${first.id}/${query}`,
    () => client.listCategoryProducts(first.id, 'es'),
    (rows) => ({
      problems: mostRowsCarry(rows, {
        id: (row) => hasText(row.externalId),
        name: (row) => hasText(row.displayName),
        'a unit price above zero': (row) => isPositive(row.price),
      }),
      sample: {
        category: first.id,
        rows: rows.length,
        firstName: rows[0]?.displayName ?? null,
        firstPriceCents: cents(rows[0]?.price),
      },
    })
  );
  const productId = listing?.find((row) => hasText(row.externalId))?.externalId;
  if (!productId) {
    return probe.result(counter.count());
  }

  const product = await probe.step(
    'product',
    `${base}/products/${productId}/${query}`,
    () => client.getProduct(productId, 'es'),
    (raw) => checkProduct(productId, raw)
  );
  if (product === undefined) {
    return probe.result(counter.count());
  }

  await probe.step(
    'shops',
    options.storesUrl ?? MERCADONA_STORES_URL,
    () =>
      MercadonaClient.listStores({
        ...shared,
        storesUrl: options.storesUrl,
        totalsUrl: options.totalsUrl,
      }),
    (list) => {
      const placed = list.stores.filter(
        (store) =>
          isFiniteNumber(store.latitude) && isFiniteNumber(store.longitude)
      ).length;
      const problems = belowFloor(list.stores.length, SHOP_FLOOR, 'shops');
      if (placed < list.stores.length) {
        problems.push(
          `${list.stores.length - placed} of ${list.stores.length} shops carried no finite latitude and longitude`
        );
      }
      return {
        problems,
        sample: {
          shops: list.stores.length,
          publishedOn: list.publishedOn ?? null,
          firstShop: list.stores[0]?.externalRef ?? null,
        },
      };
    }
  );
  return probe.result(counter.count());
}

/** The raw keys the live spec has always asserted, and a product out of them. */
function checkProduct(productId: string, raw: Json | null) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problems: [`product ${productId} answered no payload`] };
  }
  const record = raw as Record<string, unknown>;
  const problems = PRODUCT_KEYS.filter((key) => !(key in record)).map(
    (key) => `the product payload carried no ${key}`
  );
  const price = record['price_instructions'];
  if (price !== null && typeof price === 'object') {
    for (const key of PRICE_KEYS) {
      if (!(key in (price as Record<string, unknown>))) {
        problems.push(`price_instructions carried no ${key}`);
      }
    }
  }
  const product = normalizeProduct(raw);
  if (!hasText(product.externalId)) {
    problems.push('normalizeProduct answered no product id');
  }
  return {
    problems,
    sample: {
      id: product.externalId,
      ean: product.ean,
      brand: product.brand,
      priceCents: cents(product.price),
    },
  };
}

function cents(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;
}
