/**
 * The shapes `@portfolio/luna-shopper/eljamon` hands out. Plain records: nothing
 * here is an entity, a DTO or a contract view, and the harvester maps them to
 * what a run reports (plan 0169, section 5.3).
 */

/** One shop of the store locator (plan 0169, section 3). */
export interface ElJamonStore {
  /**
   * `<postalCode>:<normalized street>`. The locator has no id, and that key is
   * unique across every record. Coordinates are not part of it, because a
   * corrected pin would then read as a new shop.
   */
  externalRef: string;
  /** What the locator printed, e.g. `Supermercados El Jamón`. */
  name: string;
  latitude: number;
  longitude: number;
  street: string;
  city: string | null;
  province: string | null;
  postalCode: string;
  /** One free text line, verbatim and never parsed. */
  openingHours: string | null;
}

/** Why a locator record is not a shop of the chain. */
export type ElJamonDropReason =
  /** Another banner of the group, e.g. `Cash Lepe`, its cash and carry. */
  | 'OTHER_BANNER'
  | 'NO_POSTAL_CODE'
  | 'NO_COORDINATES'
  /** A second record with the same `externalRef` as an earlier one. */
  | 'DUPLICATE';

/** A record the locator named that the run does not report, named. */
export interface ElJamonDroppedRecord {
  reason: ElJamonDropReason;
  name: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
}

export interface ElJamonStoreList {
  /** Every record the answer held, kept or not. */
  recordsRead: number;
  stores: ElJamonStore[];
  dropped: ElJamonDroppedRecord[];
}

/** One top level category of the online shop. */
export interface ElJamonCategory {
  /** The chain's two digit code, e.g. `01`. */
  code: string;
  /** The slug in its URL, e.g. `la-despensa`. */
  slug: string;
  /** What the menu printed, e.g. `DESPENSA`. */
  name: string;
  /** `/categorias/<slug>/<code>`. */
  path: string;
}

/**
 * One row of a category listing, under a session with a postal code (plan 0169,
 * section 2.2).
 *
 * There is no availability field, and that is deliberate: the site states none
 * per shop (section 11).
 */
export interface ElJamonListingRow {
  /** The article code, which is also the last segment of the product URL. */
  code: string;
  /** The name exactly as printed, size after the last comma. */
  description: string;
  brand: string | null;
  /** The product page, absolute. */
  url: string;
  /** The current price, or null when the row printed none. */
  price: number | null;
  /** The struck through price when the product is on offer, or null. */
  previousPrice: number | null;
  unitPrice: number | null;
  /** `Kilo`, `Litro`, `Unidad`, `100gr`, verbatim, or null. */
  unitPriceLabel: string | null;
}

export interface ElJamonListingPage {
  /** What the page printed as `<n> Artículos`, or null when it printed none. */
  articleCount: number | null;
  /**
   * The JSON in the listing form's hidden `filters` input, decoded. Page N is a
   * POST of this with only `page` changed (section 5.1), so it is carried as
   * the page sent it rather than rebuilt.
   */
  filters: string | null;
  rows: ElJamonListingRow[];
}

/** What a product page adds to a listing row (plan 0169, section 2.3). */
export interface ElJamonProduct {
  code: string;
  name: string;
  brand: string | null;
  /** `offers.price` of the JSON-LD, or null. */
  price: number | null;
  image: string | null;
  /** The breadcrumb, top level first, without `Inicio` and the product. */
  categoryPath: string[];
}

export interface ElJamonClientOptions {
  /** Defaults to {@link ELJAMON_BASE_URL}. */
  baseUrl?: string;
  /** The locator's `admin-ajax.php`. Defaults to {@link ELJAMON_LOCATOR_URL}. */
  locatorUrl?: string;
  /** Where the locator search is centred. Defaults to Lepe (section 3). */
  locatorOrigin?: { latitude: number; longitude: number; label: string };
  /** Kilometres. Defaults to 1000, which reaches every shop from Lepe. */
  locatorRadiusKm?: number;
  /** The session's postal code (section 4). Defaults to `21440`. */
  postalCode?: string;
  /** Honest and naming a contact address (plan 0038, section 8.1). */
  userAgent: string;
  /**
   * Defaults to a Node transport that trusts the one intermediate certificate
   * the storefront fails to send (see `transport.ts`).
   */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  retries?: number;
  backoffBaseMs?: number;
  /** Only meaningful without an `acquire`; see the client's `gate`. */
  minIntervalMs?: number;
  /** The run's shared token bucket. One per run, never one per client. */
  acquire?: () => Promise<void>;
  signal?: AbortSignal;
}
