import type { ReviewQueue, Wire } from '@portfolio/luna-shopper-admin/models';

/** One chain and how much of one queue waits for it. */
export interface ChainWaiting {
  readonly supermarketId: string;
  readonly count: number;
}

/**
 * What waits for a decision in the four queues (admin plan 0044, target 2).
 *
 * `brands` is `null` when the brand registry did not answer the gateway. The
 * three other counts are still true then, and the total is the sum of what is
 * known.
 */
export interface HarvestWaiting {
  readonly products: number;
  readonly shops: number;
  readonly places: number;
  readonly brands: number | null;
  /** The sum, which the Review tab and the rail show. */
  readonly total: number;
  /** The chains that have source products waiting, most first. */
  readonly productsByChain: readonly ChainWaiting[];
  /** The chains that have source shops waiting, most first. */
  readonly shopsByChain: readonly ChainWaiting[];
}

/**
 * The counts of the four queues, from the harvester's block of the dashboard.
 *
 * A product waits while it is a candidate or unresolved, a shop while it is
 * unmapped, and a place while it is new. These are the same rows each queue
 * opens on, so a count on the switch is the length of the list behind it.
 */
export function harvestWaiting(
  harvest: Wire.AdminDashboardAdminHarvestDashboard
): HarvestWaiting {
  const productsByChain = byChain(
    harvest.queues.entries.map((queue) => ({
      supermarketId: queue.supermarketId,
      count: queue.candidate + queue.unresolved,
    }))
  );
  const shopsByChain = byChain(
    harvest.queues.shops.map((queue) => ({
      supermarketId: queue.supermarketId,
      count: queue.unmapped,
    }))
  );

  const products = sum(productsByChain);
  const shops = sum(shopsByChain);
  const places = harvest.queues.places;
  const brands = harvest.queues.brands;

  return {
    products,
    shops,
    places,
    brands,
    total: products + shops + places + (brands ?? 0),
    productsByChain,
    shopsByChain,
  };
}

/** The count of one queue, or `null` when it is not known. */
export function waitingIn(
  waiting: HarvestWaiting | null,
  queue: ReviewQueue
): number | null {
  return waiting === null ? null : waiting[queue];
}

/** The chains with something waiting, most first, then by id so ties hold still. */
function byChain(rows: readonly ChainWaiting[]): readonly ChainWaiting[] {
  return rows
    .filter((row) => row.count > 0)
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.supermarketId.localeCompare(right.supermarketId)
    );
}

function sum(rows: readonly ChainWaiting[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}
