/**
 * The shapes `@portfolio/luna-shopper/carrefour` hands out (plan 0090, section
 * 10). Plain records: nothing here is an entity, a DTO or a contract view, and
 * the harvester maps them to rows.
 */

/**
 * One product card exactly as the storefront renders it into the page state.
 *
 * Fourteen names appear on every card and nineteen across a page (plan 0090,
 * section 6). Only the ones a run reads are declared, and every one of them is
 * optional except the two ids and the name, because a card that lost a field is
 * a card to skip rather than a crash.
 */
export interface CarrefourCard {
  /**
   * The chain's own id, for example `VC4AECOMM-539367`, `600805795` or
   * `prod301649`.
   *
   * **It has no single shape and nothing parses it** (plan 0090, section 6). It
   * is unique across the samples that were measured and it is what the product
   * URL is built from, which is all a run needs of it.
   */
  product_id: string;
  /** A second, numeric id. Not an EAN. */
  sku_id?: string;
  /** Spanish, and it carries the size: `Cerveza Mahou clásica lata 50 cl.`. */
  name: string;
  brand?: string;
  /** Display text, `"1,10 €"`. Comma decimal, dot thousands. */
  price?: string;
  /** Display text. The comparison price, per {@link measure_unit}. */
  price_per_unit?: string;
  /** The app's own price. Equal to {@link price} in every sample measured. */
  app_price?: string;
  app_price_per_unit?: string;
  /** `l`, `kg`, `ud` and so on. The unit {@link price_per_unit} is per. */
  measure_unit?: string;
  /** How many the shopper buys at once. Not part of the product's own size. */
  sell_pack_unit?: number;
  units_in_stock?: number;
  images?: { desktop?: string; mobile?: string };
  /** The product page path, which is what the detail pass loads. */
  url?: string;
}

/**
 * One product as a run keeps it: the card, read and split.
 *
 * The price fields stay **as printed**. `priceCents` is the same figure in
 * cents, because a row needs a number, and `unitPriceLabel` is the string the
 * chain showed. Nothing here recomputes one from the other (plan 0090, section
 * 12).
 */
export interface CarrefourProduct {
  /** The card's `product_id`. This is the entry's `externalId`. */
  externalId: string;
  skuId: string | null;
  /** The card's name with its trailing size removed. Never empty. */
  name: string;
  /** The trailing size, **verbatim**, or null when the card printed none. */
  sizeFormat: string | null;
  /**
   * {@link sizeFormat} as a number in {@link measureUnit}, or null.
   *
   * Derived from the size the card printed and only when the unit it printed
   * belongs to the same family as `measure_unit`, which is what makes the split
   * checkable rather than a guess (plan 0090, section 6).
   */
  unitSize: number | null;
  brand: string | null;
  /** The till price in cents, or null for a card that printed no figure. */
  priceCents: number | null;
  /** The comparison price in cents, **verbatim** in intent: never recomputed. */
  unitPriceCents: number | null;
  /** What the chain printed beside the comparison price, for example `€/l`. */
  unitPriceLabel: string | null;
  /** The card's `measure_unit`: `l`, `kg`, `ud`. The source's own token. */
  measureUnit: string | null;
  /** The product page path, relative to the origin, or null. */
  path: string | null;
  /** The category this run saw it in, root first. */
  categoryPath: string[];
}

/** One node of the category tree, as a listing page names it. */
export interface CarrefourCategoryLink {
  /** The chain's own id, `cat20003`. A promotion view carries no such id. */
  id: string;
  /** What the navigation printed, for example `Bebidas`. */
  name: string;
  /** The listing path, `/supermercado/<seo>/<id>/c`. */
  url: string;
}

/** One category a run decided to page, with the path it was reached by. */
export interface CarrefourCategory extends CarrefourCategoryLink {
  /** Root first, this node last. What ends up on `categoryPath`. */
  path: string[];
  /** What the result set holds, which can exceed what paging will serve. */
  totalResults: number;
}

/** One rendered listing page. */
export interface CarrefourListing {
  /** The cards, unread. {@link CarrefourProduct} is the read form. */
  cards: CarrefourCard[];
  /**
   * What the result set holds. This is the number the ceiling rule compares
   * against, and it is **not** what paging will hand over.
   */
  totalResults: number;
  /**
   * What paging will actually serve: `total_pages * page_size`. It stops at
   * {@link CARREFOUR_CEILING} however large the result set is.
   */
  pageableResults: number;
  pageSize: number;
  totalPages: number;
  /** The category's own display name, when the page states one. */
  displayName: string;
  firstLevelCategories: CarrefourCategoryLink[];
  secondLevelCategories: CarrefourCategoryLink[];
}

/**
 * What a product page adds over a listing card (plan 0090, section 12.1).
 *
 * One field matters and the rest are noise: the EAN is the top rung of plan
 * 0086's ladder, so a product that carries one resolves with no person in the
 * loop.
 */
export interface CarrefourDetail {
  externalId: string;
  /** `pdp.product.ean`, a real EAN-13, or null. A missing one is a value. */
  ean: string | null;
}

/**
 * One page, loaded. The enumeration and the parsing are written against this
 * rather than against Playwright.
 */
export type CarrefourStateLoader = (
  path: string
) => Promise<Record<string, unknown> | null>;

/**
 * A browser session, reduced to what one page load needs.
 *
 * **This is the test seam, and it sits here rather than higher up on purpose.**
 * A seam above the client's own loading would skip the parts most worth
 * testing: the pacing, the counting of consecutive refusals, and dropping a
 * session that stopped answering. A fake session leaves all three in play and
 * takes only Chromium out, which is the one thing a test cannot have.
 */
export interface CarrefourSession {
  goto(
    url: string
  ): Promise<{ status: number; state: Record<string, unknown> | null }>;
  close(): Promise<void>;
}

export interface CarrefourClientOptions {
  /** Defaults to {@link CARREFOUR_ORIGIN}. */
  baseUrl?: string;
  /** Honest and naming a contact address (plan 0038, section 8.1). */
  userAgent: string;
  /**
   * Milliseconds between navigations.
   *
   * **Clamped up to {@link CARREFOUR_MIN_DELAY_MS} and never below it** (plan
   * 0090, section 13). The block escalates and does not clear at once, so this
   * is not a number to tune downward by trial against the live site.
   */
  delayMs?: number;
  /** The run's shared token bucket, awaited before every navigation. */
  acquire?: () => Promise<void>;
  signal?: AbortSignal;
  /**
   * Whether to refuse images, fonts and media. On by default: it is the
   * difference between about 250 KB and several megabytes a page, and none of
   * those bytes is read. It changes nothing about whether a page is served.
   */
  blockAssets?: boolean;
  /**
   * A session to use instead of launching Chromium. The test seam, and the
   * only way anything in CI reaches this class.
   */
  openSession?: () => Promise<CarrefourSession>;
  /** Waiting, so a test does not spend the real interval between pages. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** The origin every path is resolved against. */
export const CARREFOUR_ORIGIN = 'https://www.carrefour.es';

/** The grocery storefront, and the whole scope filter (plan 0090, section 8). */
export const CARREFOUR_STOREFRONT_PATH = '/supermercado';

/**
 * Rows paging will serve for one category, however large the result set is:
 * 42 pages of 24 (plan 0090, section 7).
 */
export const CARREFOUR_CEILING = 1008;

/** Product cards on one listing page. */
export const CARREFOUR_PAGE_SIZE = 24;

/**
 * The floor for {@link CarrefourClientOptions.delayMs}.
 *
 * 30 consecutive loads at this spacing produced 30 successes and no refusals
 * (plan 0090, section 5).
 */
export const CARREFOUR_MIN_DELAY_MS = 2000;
