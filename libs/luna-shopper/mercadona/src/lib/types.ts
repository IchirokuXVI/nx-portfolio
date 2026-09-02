import type {
  ItemCategory,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import type { CategoryPathNode } from './categories';

/**
 * The library's public shapes (plan 0038, section 3.1). Nothing here is a TypeORM
 * entity, a Nest provider or a catalog row: the library takes a warehouse code and
 * returns plain records, and the harvester maps them to rows.
 */

/** The two languages this source is asked for. See section 2.3 on Catalan. */
export type MercadonaLang = 'es' | 'en';

/** One Mercadona product, already normalized. */
export interface MercadonaProduct {
  /** Mercadona's own product id, e.g. "4241". A string, never an integer. */
  externalId: string;
  /** Present on the detail endpoint only, which is why discovery fetches detail. */
  ean: string | null;
  name: { es: string; en?: string };
  /** Detail only. Empty on the handful of novelty products that carry no brand. */
  brand: string | null;
  unitSize: number | null;
  /** Null for `size_format: 'm'`, which has no `UnitOfMeasure` value. */
  unit: UnitOfMeasure | null;
  category: ItemCategory;
  /** The path the walk took to reach it, deepest last. Drives the category map. */
  categoryPath: string[];
  /** `unit_price`: the price of the pack. This is the price. */
  price: number | null;
  /** `bulk_price`, stored verbatim and never recomputed (section 2.4). */
  unitPrice: number | null;
  /** `reference_format`, verbatim. A price tag for a human, not a machine unit. */
  unitPriceLabel: string | null;
  currency: 'EUR';
  /** False when the detail call answered 404: not stocked in this warehouse. */
  available: boolean;
  sourceUrl: string | null;
  observedAt: Date;
}

/** One node of the two level category tree. */
export interface MercadonaCategory {
  id: number;
  name: string;
  published: boolean;
  children: MercadonaCategory[];
}

/**
 * A product as it appears embedded in a category response. It carries the full
 * price block but **no `ean` and no `brand`** (section 2.5), which is the whole
 * reason a discovery run is 4,232 requests rather than 151.
 */
export interface MercadonaListProduct {
  externalId: string;
  displayName: string;
  packaging: string | null;
  shareUrl: string | null;
  published: boolean;
  unitSize: number | null;
  unit: UnitOfMeasure | null;
  sizeFormat: string | null;
  price: number | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  /**
   * The path the walk took to reach it, root first and deepest last, carrying
   * each node's id. The ids matter: section 5.6 splits cheese from cured meat by
   * level 2 id, and a path of bare names cannot express that.
   */
  categoryPath: CategoryPathNode[];
}

export interface MercadonaClientOptions {
  /** The warehouse every request is scoped to, e.g. "4661" or "mad3". */
  warehouse: string;
  /**
   * An honest User-Agent naming the app and a contact address (section 8.1).
   * Deliberately not the Chrome impersonation the public reference
   * implementations use.
   */
  userAgent: string;
  baseUrl?: string;
  /**
   * Awaited before **every** request. This is where the harvester passes its per
   * run token bucket, so the configured rate is the rate the source sees no
   * matter how many workers are running (section 6.3). Without one the client
   * falls back to `minIntervalMs`, which is only correct at concurrency one.
   */
  acquire?: () => Promise<void>;
  /** Sequential fallback pacing, used when no `acquire` is supplied. */
  minIntervalMs?: number;
  /** Retries on 429 and 5xx, with exponential backoff and jitter. */
  retries?: number;
  /** First backoff step in ms; each retry doubles it and adds jitter. */
  backoffBaseMs?: number;
  /** Injected in tests. Defaults to Node's global fetch; no HTTP dependency. */
  fetchImpl?: typeof fetch;
  /** Threaded through every call, which is what section 6.5's abort is built on. */
  signal?: AbortSignal;
  /** Injected in tests so backoff does not actually sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injected in tests so `observedAt` is deterministic. */
  now?: () => Date;
}
