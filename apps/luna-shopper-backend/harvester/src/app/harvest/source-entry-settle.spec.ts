import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { SourceEntrySettler } from './source-entry-settle';
import { SourceEntryPriceWriter } from './source-entry-write';

/**
 * Settling a product at a chain (plan 0191): what the harvester asks catalog
 * for, in which order, given the rows bound to the product now.
 *
 * Which rows are bound is a query, and what catalog removes is catalog's. Both
 * are proved against real Postgres, in `source-entry-settle.integration.spec.ts`
 * here and `item-withdraw.integration.spec.ts` in catalog. This pins the part
 * in between: the three answers a scope and kind can get, that an offer is
 * asked about only when no row names the product, and that a dry run writes
 * nothing.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const ITEM = 'item-old';
const DEFAULT = 'scope-default';
const NORTH = 'scope-north';
const SOUTH = 'scope-south';
const GONE = 'scope-deleted';
const RUN = 'run-monday';
const OBSERVED = new Date('2026-10-05T06:00:00.000Z');

const KINDS = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

function price(
  entryId: string,
  amount: number,
  over: Partial<SourceEntryPrice> = {}
): SourceEntryPrice {
  return {
    id: `price-${entryId}-${over.priceScopeId ?? DEFAULT}`,
    entryId,
    priceScopeId: DEFAULT,
    price: amount,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    validFrom: null,
    validUntil: null,
    details: null,
    observedAt: OBSERVED,
    runId: RUN,
    copiedFromScopeId: null,
    ...over,
  } as SourceEntryPrice;
}

function row(
  id: string,
  prices: SourceEntryPrice[],
  over: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return {
    id,
    supermarketId: CHAIN,
    sourceKind: PriceSourceKind.OFFICIAL_WEB,
    externalId: id,
    name: 'Burger El Pozo',
    itemId: ITEM,
    status: SourceEntryStatus.ACTIVE,
    soldByWeight: false,
    decidedAt: new Date('2026-10-01T00:00:00.000Z'),
    prices,
    ...over,
  } as SourceCatalogEntry;
}

function build(bound: SourceCatalogEntry[]) {
  /** Every call to catalog, in order, by the name of what was called. */
  const calls: string[] = [];
  const find = jest.fn(async () => bound);
  const withdrawPrices = jest.fn(
    async (
      _itemId: string,
      _scopes: string[],
      _kinds: PriceSourceKind[],
      _stated: unknown[],
      _dryRun?: boolean
    ) => {
      calls.push('withdrawPrices');
      return {
        deleted: 3,
        removed: [
          {
            priceScopeId: DEFAULT,
            sourceKind: PriceSourceKind.OFFICIAL_WEB,
            deleted: 3,
          },
        ],
        recomputed: 4,
      };
    }
  );
  const withdrawOffers = jest.fn(async () => {
    calls.push('withdrawOffers');
    return {
      offersRemoved: [DEFAULT, NORTH, SOUTH],
      offersKept: [],
      shopRowsRemoved: 2,
      shopRowsCleared: 0,
      conflicts: [],
    };
  });
  const addPrices = jest.fn(async () => {
    calls.push('addPrices');
    return { inserted: 1, confirmed: 0 };
  });
  const catalog = {
    listAllPriceScopes: jest.fn(async () => [
      { id: DEFAULT },
      { id: NORTH },
      { id: SOUTH },
    ]),
    withdrawPrices,
    withdrawOffers,
    addPrices,
  } as unknown as CatalogClient;
  const entries = { find } as unknown as Repository<SourceCatalogEntry>;
  const settler = new SourceEntrySettler(
    entries,
    catalog,
    new SourceEntryPriceWriter(catalog, entries)
  );
  return { settler, find, withdrawPrices, withdrawOffers, addPrices, calls };
}

describe('SourceEntrySettler (plan 0191)', () => {
  it('reads the rows of the chain that are bound to the product now', async () => {
    const { settler, find } = build([]);

    await settler.settle(ITEM, CHAIN);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          supermarketId: CHAIN,
          itemId: ITEM,
          status: SourceEntryStatus.ACTIVE,
        },
        relations: { prices: true },
      })
    );
  });

  describe('no row of the chain names the product', () => {
    it('withdraws the run written prices at every scope and kind, then the offers', async () => {
      const { settler, withdrawPrices, withdrawOffers, addPrices, calls } =
        build([]);

      const result = await settler.settle(ITEM, CHAIN);

      // Nothing is stated, so nothing is spared.
      expect(withdrawPrices).toHaveBeenCalledWith(
        ITEM,
        [DEFAULT, NORTH, SOUTH],
        KINDS,
        [],
        false
      );
      expect(withdrawOffers).toHaveBeenCalledWith(
        ITEM,
        CHAIN,
        [DEFAULT, NORTH, SOUTH],
        null
      );
      expect(addPrices).not.toHaveBeenCalled();
      // The prices first: an offer goes only when nothing prices it.
      expect(calls).toEqual(['withdrawPrices', 'withdrawOffers']);
      expect(result).toEqual({
        itemId: ITEM,
        supermarketId: CHAIN,
        dryRun: false,
        boundEntryIds: [],
        pricesWithdrawn: 3,
        pricesWithdrawnAt: [
          {
            priceScopeId: DEFAULT,
            sourceKind: PriceSourceKind.OFFICIAL_WEB,
            deleted: 3,
          },
        ],
        pricesRestated: 0,
        pricesWithheld: [],
        offersRemoved: [DEFAULT, NORTH, SOUTH],
        offersKept: [],
        shopRowsRemoved: 2,
        shopRowsCleared: 0,
        shopRowConflicts: [],
      });
    });
  });

  describe('a row of the chain still names the product', () => {
    it('spares what it states, writes it again after the delete, and keeps every offer', async () => {
      const kept = row('0e539371', [price('0e539371', 2.45)]);
      const { settler, withdrawPrices, withdrawOffers, addPrices, calls } =
        build([kept]);

      const result = await settler.settle(ITEM, CHAIN);

      expect(withdrawPrices).toHaveBeenCalledWith(
        ITEM,
        [DEFAULT, NORTH, SOUTH],
        KINDS,
        [
          {
            priceScopeId: DEFAULT,
            sourceKind: PriceSourceKind.OFFICIAL_WEB,
            observedAt: OBSERVED.toISOString(),
          },
        ],
        false
      );
      // The 2.45 is written again, with its own run and its own instant.
      expect(addPrices).toHaveBeenCalledTimes(1);
      expect(addPrices).toHaveBeenCalledWith(
        DEFAULT,
        [
          expect.objectContaining({
            itemId: ITEM,
            price: 2.45,
            observedAt: OBSERVED.toISOString(),
          }),
        ],
        RUN,
        PriceSourceKind.OFFICIAL_WEB,
        null
      );
      expect(calls).toEqual(['withdrawPrices', 'addPrices']);
      // A chain that lists a product sells it: the offers are not asked about.
      expect(withdrawOffers).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        boundEntryIds: ['0e539371'],
        pricesRestated: 1,
        offersRemoved: [],
        shopRowsRemoved: 0,
      });
    });

    it('spares everything and writes nothing where two rows state two amounts', async () => {
      // The row decided first is named first.
      const small = row('small', [price('small', 2.45)], {
        decidedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      const king = row('king', [
        price('king', 2.95),
        price('king', 3.05, { priceScopeId: NORTH }),
      ]);
      const { settler, withdrawPrices, addPrices } = build([small, king]);

      const result = await settler.settle(ITEM, CHAIN);

      const stated = withdrawPrices.mock.calls[0][3];
      // The shared scope: a null instant, which spares every row there. The
      // price that was current before the conflict stays and ages.
      expect(stated).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: null,
        },
        {
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          observedAt: OBSERVED.toISOString(),
        },
      ]);
      // Only the scope one row prices is written again.
      expect(addPrices).toHaveBeenCalledTimes(1);
      expect(addPrices).toHaveBeenCalledWith(
        NORTH,
        [expect.objectContaining({ price: 3.05 })],
        RUN,
        PriceSourceKind.OFFICIAL_WEB,
        null
      );
      expect(result.pricesRestated).toBe(1);
      expect(result.pricesWithheld).toEqual([
        { entryId: 'small', priceScopeId: DEFAULT, otherEntryIds: ['king'] },
        { entryId: 'king', priceScopeId: DEFAULT, otherEntryIds: ['small'] },
      ]);
    });

    it('states nothing for a price whose window closed, or whose scope catalog no longer holds', async () => {
      const kept = row('kept', [
        price('kept', 1.99, {
          validUntil: new Date('2020-01-01T00:00:00.000Z'),
        }),
        price('kept', 2.1, { priceScopeId: GONE }),
      ]);
      const { settler, withdrawPrices, addPrices } = build([kept]);

      const result = await settler.settle(ITEM, CHAIN);

      expect(withdrawPrices.mock.calls[0][3]).toEqual([]);
      expect(addPrices).not.toHaveBeenCalled();
      expect(result.pricesRestated).toBe(0);
    });
  });

  describe('a dry run', () => {
    it('asks catalog what it would remove and sends no price', async () => {
      const kept = row('kept', [price('kept', 2.45)]);
      const { settler, withdrawPrices, addPrices } = build([kept]);

      const result = await settler.settle(ITEM, CHAIN, { dryRun: true });

      expect(withdrawPrices.mock.calls[0][4]).toBe(true);
      expect(addPrices).not.toHaveBeenCalled();
      // The same count a real call answers: what would be sent again.
      expect(result).toMatchObject({ dryRun: true, pricesRestated: 1 });
    });

    it('asks about the offers as if the prices were already gone', async () => {
      const { settler, withdrawOffers } = build([]);

      const result = await settler.settle(ITEM, CHAIN, { dryRun: true });

      // The call that removes the prices was a dry run too, so catalog is
      // told which kinds to count as gone before it looks at the offers.
      expect(withdrawOffers).toHaveBeenCalledWith(
        ITEM,
        CHAIN,
        [DEFAULT, NORTH, SOUTH],
        { assumePricesWithdrawn: KINDS }
      );
      expect(result.offersRemoved).toEqual([DEFAULT, NORTH, SOUTH]);
    });
  });
});
