import type {
  PriceRefreshRefusal,
  PriceRefreshStatus,
} from '../enums/price-refresh.enums';

/**
 * A shopper refreshes the price of one product (harvester plan 0216, section
 * 7).
 *
 * **The only harvester subjects open to a shopper.** Each takes the `userId`
 * that the gateway verified, and no operator credential. Every other harvester
 * subject is gated on an operator token.
 */
export const PRICE_REFRESH_PATTERNS = {
  /** Start a refresh, join one in flight, or answer `FRESH` (section 7.1). */
  request: 'priceRefresh.request',
  /** What a request would answer now, without claiming anything (section 7.2). */
  check: 'priceRefresh.check',
  /** One refresh this shopper requested or joined (section 7.3). */
  get: 'priceRefresh.get',
} as const;

/** The product and the scope the shopper is looking at, for a request or a check. */
export interface PriceRefreshRequest {
  userId: string;
  itemId: string;
  /** The `priceScopeId` of the offer the client drew. */
  priceScopeId: string;
}

/** One refresh by id. */
export interface PriceRefreshIdRequest {
  userId: string;
  refreshId: string;
}

/** A refresh as the shopper polls it. */
export interface PriceRefreshView {
  /** Null for `FRESH`, which started nothing. */
  id: string | null;
  itemId: string;
  priceScopeId: string;
  status: PriceRefreshStatus;
  /**
   * The stored observation time at the fetch scope, after the refresh when it
   * is `DONE`. Null when the stored row carries none.
   */
  observedAt: string | null;
  /** Null for `FRESH`. */
  requestedAt: string | null;
  /** Null while `PENDING`, and for `FRESH`. */
  finishedAt: string | null;
}

/** What a request would answer now, read without claiming a cooldown. */
export interface PriceRefreshCheckView {
  /** Whether a request can refresh this product here, now or after the wait. */
  refreshable: boolean;
  /** Null when refreshable. */
  reason: PriceRefreshRefusal | null;
  /**
   * Seconds until a request can pass the cooldowns. Zero when it can now. For
   * `FRESH`, the seconds until the product window ends.
   */
  retryAfterSeconds: number;
  /** The refresh in flight for this product and scope, which a request joins. */
  pendingRefreshId: string | null;
  /** The stored observation time at the fetch scope, or null when unknown. */
  observedAt: string | null;
}
