import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { harvestWaiting, waitingIn } from './harvest-waiting';

/**
 * What waits in the four queues of Review (admin plan 0044, target 2).
 *
 * The count on the rail, on the Review tab and on each entry of the queue
 * switch all come from here, so a wrong sum is wrong in three places at once.
 */

const A = 'chain-a';
const B = 'chain-b';
const C = 'chain-c';

function harvest(
  queues: Partial<Wire.AdminDashboardAdminHarvestDashboard['queues']> = {}
): Wire.AdminDashboardAdminHarvestDashboard {
  return {
    runs: { byStatus: [], inWindow: 0 },
    running: null,
    recent: [],
    queues: { entries: [], places: 0, shops: [], brands: 0, ...queues },
    sources: { total: 0, enabled: 0 },
  };
}

describe('harvestWaiting', () => {
  /** A product waits while it is a candidate or unresolved. */
  it('counts the candidates and the unresolved of every chain as products', () => {
    const waiting = harvestWaiting(
      harvest({
        entries: [
          { supermarketId: A, candidate: 18, unresolved: 42 },
          { supermarketId: B, candidate: 6, unresolved: 0 },
        ],
      })
    );

    expect(waiting.products).toBe(66);
  });

  it('counts the unmapped of every chain as shops', () => {
    const waiting = harvestWaiting(
      harvest({
        shops: [
          { supermarketId: A, unmapped: 4 },
          { supermarketId: B, unmapped: 27 },
        ],
      })
    );

    expect(waiting.shops).toBe(31);
  });

  it('takes the places and the brands as the block states them', () => {
    const waiting = harvestWaiting(harvest({ places: 14, brands: 7 }));

    expect(waiting.places).toBe(14);
    expect(waiting.brands).toBe(7);
  });

  it('sums the four queues', () => {
    const waiting = harvestWaiting(
      harvest({
        entries: [{ supermarketId: A, candidate: 90, unresolved: 6 }],
        shops: [{ supermarketId: A, unmapped: 31 }],
        places: 14,
        brands: 7,
      })
    );

    expect(waiting.total).toBe(148);
  });

  /**
   * The brand registry did not answer the gateway. The three other counts are
   * still true, so the total is what is known and the brands stay unknown.
   */
  it('sums the three known queues when the brands are not known', () => {
    const waiting = harvestWaiting(
      harvest({
        entries: [{ supermarketId: A, candidate: 1, unresolved: 2 }],
        shops: [{ supermarketId: A, unmapped: 3 }],
        places: 4,
        brands: null,
      })
    );

    expect(waiting.brands).toBeNull();
    expect(waiting.total).toBe(10);
  });

  it('is all zeros for a harvester with nothing waiting', () => {
    expect(harvestWaiting(harvest())).toEqual({
      products: 0,
      shops: 0,
      places: 0,
      brands: 0,
      total: 0,
      productsByChain: [],
      shopsByChain: [],
    });
  });

  /** The Shops queue lists these when no chain is chosen. */
  it('lists the chains with something waiting, most first', () => {
    const waiting = harvestWaiting(
      harvest({
        shops: [
          { supermarketId: A, unmapped: 4 },
          { supermarketId: B, unmapped: 0 },
          { supermarketId: C, unmapped: 27 },
        ],
        entries: [
          { supermarketId: A, candidate: 0, unresolved: 0 },
          { supermarketId: B, candidate: 2, unresolved: 3 },
          { supermarketId: C, candidate: 9, unresolved: 0 },
        ],
      })
    );

    expect(waiting.shopsByChain).toEqual([
      { supermarketId: C, count: 27 },
      { supermarketId: A, count: 4 },
    ]);
    expect(waiting.productsByChain).toEqual([
      { supermarketId: C, count: 9 },
      { supermarketId: B, count: 5 },
    ]);
  });

  /** Ties hold still, so a list does not reorder itself between two reads. */
  it('orders chains with the same count by id', () => {
    const waiting = harvestWaiting(
      harvest({
        shops: [
          { supermarketId: C, unmapped: 2 },
          { supermarketId: A, unmapped: 2 },
          { supermarketId: B, unmapped: 2 },
        ],
      })
    );

    expect(waiting.shopsByChain.map((row) => row.supermarketId)).toEqual([
      A,
      B,
      C,
    ]);
  });
});

describe('waitingIn', () => {
  const waiting = harvestWaiting(
    harvest({
      entries: [{ supermarketId: A, candidate: 5, unresolved: 0 }],
      shops: [{ supermarketId: A, unmapped: 3 }],
      places: 2,
      brands: null,
    })
  );

  it('answers the count of one queue', () => {
    expect(waitingIn(waiting, 'products')).toBe(5);
    expect(waitingIn(waiting, 'shops')).toBe(3);
    expect(waitingIn(waiting, 'places')).toBe(2);
  });

  it('answers no count for a queue whose count is not known', () => {
    expect(waitingIn(waiting, 'brands')).toBeNull();
  });

  /**
   * The chain filter narrows all four queues, so the switch counts what the
   * list behind it holds. Only the products and the shops are counted by
   * chain.
   */
  it('answers the count of the chosen chain, where the queue is counted by chain', () => {
    expect(waitingIn(waiting, 'products', A)).toBe(5);
    expect(waitingIn(waiting, 'shops', A)).toBe(3);
    // A chain with nothing waiting is a zero, which draws nothing.
    expect(waitingIn(waiting, 'products', 'sm_other')).toBe(0);
    expect(waitingIn(waiting, 'shops', 'sm_other')).toBe(0);
  });

  it('answers no count for a queue that is not counted by chain, once a chain is chosen', () => {
    expect(waitingIn(waiting, 'places', A)).toBeNull();
    expect(waitingIn(waiting, 'brands', A)).toBeNull();
  });

  it('answers no count at all before anything is known', () => {
    expect(waitingIn(null, 'products')).toBeNull();
    expect(waitingIn(null, 'brands')).toBeNull();
  });
});
