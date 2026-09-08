import type {
  ItemCategory,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';

/**
 * The library's public shapes (plan 0089, section 6). Nothing here is a TypeORM
 * entity, a Nest provider or a catalog row: the library answers with plain
 * records, and the harvester maps them to rows.
 */

/** Where the product index and the product pages are served from. */
export const LIDL_BASE_URL = 'https://www.lidl.es';

/** Where the store list is served from. A different host and a different key. */
export const LIDL_STORES_URL =
  'https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores';

/**
 * The key the public store search bundle ships, which every browser sends (plan
 * 0089, section 10).
 *
 * **It is configuration and not a secret.** It is here as the default so that a
 * store discovery run works with nothing set, and `LIDL_STORES_API_KEY`
 * overrides it when the chain rotates it. A 401 is the signal that it has.
 */
export const LIDL_PUBLIC_STORES_API_KEY = '16QaHsGX3Uc3JLhNlS2ZG1CmosbzVPs2';

/**
 * The coarse category the site files a product under, which is the first
 * segment of the `category` field (plan 0089, section 5).
 *
 * `Food` and `F+V` are what a supermarket sells. `NonFood` is the weekly bazar
 * and `P+F` is plants, and neither is a shopping list line. Anything starting
 * `Categorías/` is the online shop, which a shop happens to stock.
 */
export const LIDL_GROCERY_CATEGORIES: ReadonlySet<string> = new Set([
  'Food',
  'F+V',
]);

/**
 * One row of the product index (`/q/api/search`).
 *
 * It carries a price and a printed size but **no EAN and no per region price**,
 * which is why a run pays one product page per row it keeps (section 3).
 */
export interface LidlListRow {
  /** `productId`. Stable across weeks, and what the product URL is built from. */
  externalId: string;
  name: string;
  brand: string | null;
  /** The site's own coarse category, first segment only (`Food`, `F+V`, …). */
  siteCategory: string;
  /** The need world path, root first, as the index printed it. */
  categoryPath: string[];
  /** `canonicalPath`, e.g. `/p/uva-blanca/p11029954`. Relative to the base URL. */
  path: string | null;
  /** The printed size, verbatim: `500 g`, `6x200ml`, `Aprox. 950g`, `Paquete`. */
  sizeFormat: string | null;
  /** What the index showed. The product page is what a run actually writes. */
  listPrice: number | null;
  /** LIDL's internal article number. Never an EAN (section 7). */
  ian: string | null;
}

/** One region of the price map: an opaque group of shops LIDL prices together. */
export interface LidlRegion {
  /** The region id, as a string: `PriceScope.externalKey` is a varchar. */
  id: string;
  name: string | null;
}

/**
 * One price, and every region that pays it.
 *
 * The source publishes a price id per region and a price per price id, so a
 * product can carry as many prices as it has regions. The grouping is the
 * source's own and is kept: a run writes one ingest call per group, and a model
 * that collapsed the regions that agree this week could not store next week's
 * disagreement (section 4).
 */
export interface LidlRegionPrice {
  /** The source's price id, which is what the regions below point at. */
  priceId: string;
  regions: LidlRegion[];
  /** The shelf price. Null is never written: an unpriced region is dropped. */
  price: number;
  /** The price before the discount, when the article is discounted. */
  oldPrice: number | null;
  currency: string;
  /** When the price starts. Next week's prices are already published. */
  validFrom: Date | null;
  validUntil: Date | null;
  /** The size printed beside this price, which can differ from the index's. */
  sizeFormat: string | null;
}

/** One LIDL product, read from its own page and normalized. */
export interface LidlProduct {
  externalId: string;
  name: string;
  brand: string | null;
  /**
   * Thirteen digits, or null. **An eight digit `eans` value is not an EAN**
   * (section 7): it is LIDL's own code for a weight item, it is kept in
   * {@link shortCode}, and writing it into the EAN column would collide with a
   * real EAN-8 from another chain.
   */
  ean: string | null;
  /** The `eans` value that was not an EAN-13, for an admin to look at. */
  shortCode: string | null;
  ian: string | null;
  siteCategory: string;
  categoryPath: string[];
  /** The need world path mapped onto our own enum, `OTHER` when it does not. */
  category: ItemCategory;
  unitSize: number | null;
  unit: UnitOfMeasure | null;
  /** The printed size, verbatim, so nothing is lost when the parse gives up. */
  sizeFormat: string | null;
  url: string | null;
  /**
   * `storeFacts.retail === true && storeFacts.online === false`, the clean
   * predicate of section 5. False means the online shop, which a shop stocks
   * but a supermarket run is not about.
   */
  inStore: boolean;
  /**
   * One entry per distinct price, with the regions that pay it. **Empty is a
   * real answer**: 21 of the week's products are in the window with no price at
   * all, and they are written as products without a price rather than skipped.
   */
  prices: LidlRegionPrice[];
  observedAt: Date;
}

/** One shop, from the store service. Every field below was present on all 730. */
export interface LidlStore {
  /** `objectNumber`, e.g. `ES00215`. */
  externalRef: string;
  name: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /** The autonomous community the store service prints, e.g. `Aragón`. */
  state: string | null;
  latitude: number;
  longitude: number;
  /**
   * The price region this shop belongs to, stated by the chain and never
   * derived from the postal code (section 4.1). Present on all 730 records.
   */
  regionId: string | null;
  regionName: string | null;
  /** `PEN`, `BAL`, `CAN`. Coarser than a region and not what a price keys on. */
  zone: string | null;
  /** The week's opening hours, collapsed to one line. */
  openingHours: string | null;
}

export interface LidlClientOptions {
  /**
   * An honest User-Agent naming the app and a contact address. The walk is a
   * URL shape `robots.txt` disallows, so the rate limit is a real constraint
   * and not a formality (section 10).
   */
  userAgent: string;
  baseUrl?: string;
  storesUrl?: string;
  /** Defaults to {@link LIDL_PUBLIC_STORES_API_KEY}. A 401 means it rotated. */
  storesApiKey?: string;
  /** How many index rows one request asks for. The endpoint caps it at 1,000. */
  pageSize?: number;
  /**
   * Awaited before **every** request. This is where the harvester passes its per
   * run token bucket, so the configured rate is the rate the source sees no
   * matter how many workers are running.
   */
  acquire?: () => Promise<void>;
  /** Sequential fallback pacing, used when no `acquire` is supplied. */
  minIntervalMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  /** Injected in tests. Defaults to Node's global fetch; no HTTP dependency. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injected in tests so `observedAt` is deterministic. */
  now?: () => Date;
}
