import {
  adapterCapabilities,
  type SupermarketItemAvailabilityEntry,
} from '@portfolio/luna-shopper/contracts';

/**
 * The pure half of the delisting counter (plan 0220, sections 4, 5 and 15).
 *
 * Nothing here reads a table or a clock: the counter in
 * `delisting.service.ts` passes the rows and the instant in, so every rule is
 * tested with no database.
 */

/** The defaults of section 5, and the bounds a chain's override must meet. */
export const DELIST_AFTER_WALKS = { fallback: 3, min: 1, max: 52 } as const;
export const DELIST_AFTER_DAYS = { fallback: 14, min: 0, max: 365 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many whole walks and how many days make a pair gone (section 5). */
export interface DelistingThreshold {
  walks: number;
  days: number;
  /** True when both values are the defaults, whatever the config held. */
  fromDefaults: boolean;
  /** Each override that was out of range or not an integer, and ignored. */
  ignored: { key: string; value: unknown }[];
}

/**
 * The threshold of one chain, from its `supermarket_sources.config` (section
 * 5): `delistAfterWalks` (1 to 52, default 3) and `delistAfterDays` (0 to 365,
 * default 14). A value outside its range, or not an integer, is ignored and
 * named, and the default applies. No environment variable (plan 0083).
 */
export function readDelistingThreshold(
  config: Record<string, unknown> | null | undefined
): DelistingThreshold {
  const ignored: DelistingThreshold['ignored'] = [];
  const read = (
    key: string,
    bounds: { fallback: number; min: number; max: number }
  ): number => {
    const value = config?.[key];
    if (value === undefined || value === null) {
      return bounds.fallback;
    }
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= bounds.min &&
      value <= bounds.max
    ) {
      return value;
    }
    ignored.push({ key, value });
    return bounds.fallback;
  };
  const walks = read('delistAfterWalks', DELIST_AFTER_WALKS);
  const days = read('delistAfterDays', DELIST_AFTER_DAYS);
  return {
    walks,
    days,
    fromDefaults:
      walks === DELIST_AFTER_WALKS.fallback &&
      days === DELIST_AFTER_DAYS.fallback,
    ignored,
  };
}

/**
 * Section 5: gone after `walks` whole walks in a row that did not list the
 * product, and at least `days` days after the first of them. Both hold, so a
 * daily schedule cannot make a product gone in three days, and a week out of
 * stock at DIA does not either.
 */
export function isGone(
  missedWalks: number,
  firstMissedAt: Date | null,
  now: Date,
  threshold: Pick<DelistingThreshold, 'walks' | 'days'>
): boolean {
  if (firstMissedAt === null || missedWalks < threshold.walks) {
    return false;
  }
  return firstMissedAt.getTime() <= now.getTime() - threshold.days * DAY_MS;
}

/**
 * `supermarket_sources.config.delistCountsCrawl` (section 15.4): true only
 * for a JSON `true`. It lets a Carrefour crawl declare a whole listing.
 */
export function readDelistCountsCrawl(
  config: Record<string, unknown> | null | undefined
): boolean {
  return config?.['delistCountsCrawl'] === true;
}

/**
 * Whether a run of this chain may declare a whole listing (section 15.3).
 *
 * The adapter's `provesDelisting`, or for `carrefour-web` the chain's own
 * switch. The table of capabilities stays a fact about the storefront: the
 * switch is read here and changes nothing in it.
 */
export function provesDelistingFor(
  adapterKey: string | null | undefined,
  config: Record<string, unknown> | null | undefined
): boolean {
  return (
    adapterCapabilities(adapterKey).provesDelisting ||
    (adapterKey === 'carrefour-web' && readDelistCountsCrawl(config))
  );
}

/** What a scope says about one pair, read off its presence row. */
export type PairState = 'listed' | 'outOfStock' | 'gone';

/** The columns of a presence row that decide its state. */
export interface PairRow {
  missedWalks: number;
  goneAt: Date | null;
}

/**
 * Listed while no whole walk missed it, out of stock from the first miss until
 * the threshold (section 15.1), and gone after it.
 */
export function stateOf(row: PairRow): PairState {
  if (row.goneAt !== null) {
    return 'gone';
  }
  return row.missedWalks > 0 ? 'outOfStock' : 'listed';
}

/**
 * The state of a product at a scope, over every `ACTIVE` row of the chain
 * bound to it that has a presence row there (section 6.2).
 *
 * A row still listed keeps the product listed, and a row that is not gone
 * keeps it from being gone: the product is gone only when every such row is.
 */
export function itemStateOf(rows: readonly PairRow[]): PairState {
  const states = rows.map(stateOf);
  if (states.includes('listed')) {
    return 'listed';
  }
  return states.includes('outOfStock') ? 'outOfStock' : 'gone';
}

/**
 * What catalog is told for a product in this state (sections 6.1 and 15.1).
 *
 * - **The first miss** sends `outOfStock` alone. It leaves `available` as it
 *   is, so a product a 404 turned off at this scope stays off, and catalog
 *   creates no row where the scope has none.
 * - **The threshold** says the product is not sold, and leaves `outOfStockAt`
 *   as it is.
 * - **A walk that lists it again** clears `delistedAt` and nothing else. The
 *   sink already stated the walk's positive and its claims (DIA's stock,
 *   Mercadona's 404) before the counter runs, and this must not override
 *   them. Only a product that was gone is turned on here, and only when the
 *   run made no claim about it at this scope (`cameBack`): the sink sends no
 *   positive for a named row whose detail failed.
 */
export function statementOf(
  itemId: string,
  state: PairState,
  cameBack = false
): SupermarketItemAvailabilityEntry {
  switch (state) {
    case 'listed':
      return cameBack
        ? { itemId, available: true, delisted: false }
        : { itemId, delisted: false };
    case 'outOfStock':
      return { itemId, outOfStock: true };
    case 'gone':
      return { itemId, available: false, delisted: true };
  }
}

/** Why a run counted nothing (section 8). */
export type DelistingNotCounted =
  | 'run-not-completed'
  | 'prices-only'
  | 'detail-backfill'
  | 'no-whole-listing';

/** A scope a runner walked and did not declare whole, and why (section 8). */
export interface NotWholeListing {
  key: string | null;
  reason: string;
  detail: readonly unknown[];
}

/** One counted scope, as the run report names it (section 8). */
export interface DelistingScopeReport {
  scopeId: string;
  key: string | null;
  listed: number;
  seeded: number;
  missed: number;
  /** Pairs whose first miss this was, which catalog is told are out of stock. */
  newlyOutOfStock: number;
  newlyGone: number;
  cameBack: number;
}

/** The `delisting` section of `harvest_runs.report` (section 8). */
export interface DelistingReport {
  counted: boolean;
  notCountedBecause: DelistingNotCounted | null;
  threshold: { walks: number; days: number; fromDefaults: boolean };
  /** Each override of the threshold that was out of range, and ignored. */
  thresholdIgnored: { key: string; value: unknown }[];
  scopes: DelistingScopeReport[];
  notWhole: NotWholeListing[];
  entriesDelisted: number;
  entriesBack: number;
  catalogSent: number;
  catalogFailed: number;
  /** Products catalog kept sold for a current person or leaflet price (15.6). */
  catalogKeptSold: number;
  error: string | null;
}

/** A report with nothing counted, for a run the counter did not run for. */
export function uncountedReport(
  because: DelistingNotCounted,
  threshold: DelistingThreshold,
  notWhole: readonly NotWholeListing[]
): DelistingReport {
  return {
    counted: false,
    notCountedBecause: because,
    threshold: {
      walks: threshold.walks,
      days: threshold.days,
      fromDefaults: threshold.fromDefaults,
    },
    thresholdIgnored: threshold.ignored,
    scopes: [],
    notWhole: [...notWhole],
    entriesDelisted: 0,
    entriesBack: 0,
    catalogSent: 0,
    catalogFailed: 0,
    catalogKeptSold: 0,
    error: null,
  };
}
