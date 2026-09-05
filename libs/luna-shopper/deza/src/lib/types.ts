/**
 * The shapes `@portfolio/luna-shopper/deza` hands out. Plain records: nothing
 * here is an entity, a DTO or a contract view, and the harvester maps them to
 * rows (plan 0085, section 5).
 */

/** One node of the section tree, read from the search form rather than pinned. */
export interface DezaSection {
  /** The chain's own code, e.g. `W011000009`. Empty string is "every section". */
  code: string;
  /** What the form printed, e.g. `Carniceria`. */
  name: string;
  /** Root first, this node last. What ends up on `categoryPath`. */
  path: string[];
  children: DezaSection[];
}

/** One shop a product's popup named, by code and by the name it printed. */
export interface DezaShop {
  /**
   * The source's own key, `T1` to `T7`, `C1`, `C2`, `Z1`. **Not the printed
   * name**: only the code survives a rename (plan 0084, section 6).
   */
  code: string;
  printedName: string;
}

/**
 * One row of the listing.
 *
 * There is **no price field, and that is deliberate**. Every shop in every popup
 * carries a `wpdz-precio-ok` and a `wpdz-precio-oculto` element and both are
 * blank on the public site: they are the storefront's own hidden pricing, not a
 * field waiting to be read, and a parser that treated a blank string as a price
 * would write zeros (plan 0085, section 1).
 *
 * There is no product id, no EAN and no product URL either. The source gives a
 * description, a few attribute icons and the shops that carry it.
 */
export interface DezaProductRow {
  /** The description exactly as printed, size and all. */
  description: string;
  /** The description with the trailing size removed (section 7). */
  name: string;
  /** The trailing size, **verbatim**, or null when the row states none. */
  sizeFormat: string | null;
  /** The longest run of capitals in {@link name}, or null (section 8). */
  brand: string | null;
  /** The chain's attribute icons, e.g. `Andaluz`, `Sin gluten` (section 8). */
  attributes: string[];
  /**
   * The shops that carry it. **Availability is by omission**: a shop missing
   * from this list does not stock the product, which is the strongest claim this
   * source makes and the reason plan 0084 exists.
   */
  shops: DezaShop[];
}

/** One rendered page of a query. */
export interface DezaPage {
  rows: DezaProductRow[];
  /**
   * The highest page the widget offers, or 0 when it offers none. A query whose
   * last page is {@link DEZA_CEILING_PAGES} is at the source's 300 row ceiling
   * and section 3 narrows it; anything lower is the whole result set.
   */
  lastPage: number;
}

/** A section, optionally narrowed by search terms (plan 0085, section 3). */
export interface DezaQuery {
  /** A section code, or `''` for the whole catalog. */
  section: string;
  /**
   * Substring terms, ANDed by the source. `wpdz-input-name` matches anywhere in
   * the description, so `ino` matches `Vino`, and two terms both have to appear.
   */
  terms?: string[];
}

export interface DezaClientOptions {
  /** Defaults to {@link DEZA_BASE_URL}. */
  baseUrl?: string;
  /** Honest and naming a contact address (plan 0038, section 8.1). */
  userAgent: string;
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
