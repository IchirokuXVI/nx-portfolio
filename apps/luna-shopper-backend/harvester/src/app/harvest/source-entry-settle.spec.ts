import {
  HarvestRunMode,
  PriceSourceKind,
  SourceEntryStatus,
  type HeldItemPrice,
  type StatedItemPrice,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type {
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { SourceEntrySettler } from './source-entry-settle';

/**
 * Settling a product at a chain (plan 0191): what the harvester tells catalog,
 * given the rows bound to the product now.
 *
 * Which rows are bound is a query, and what catalog removes is catalog's. Both
 * are proved against real Postgres, in `source-entry-settle.integration.spec.ts`
 * here and `item-withdraw.integration.spec.ts` in catalog, and the two together
 * in `settle-across-services.integration.spec.ts`. This pins the part in
 * between: what counts as held, what is stated and under which kind, that an
 * offer is asked about only when no row names the product, and that a dry run
 * is the same question.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const ITEM = 'item-old';
const DEFAULT = 'scope-default';
const NORTH = 'scope-north';
const SOUTH = 'scope-south';
const GONE = 'scope-deleted';
/** A walk of the chain's website. */
const RUN = 'run-monday';
/** An older walk. */
const OLD_RUN = 'run-last-month';
/** A leaflet an operator uploaded. */
const LEAFLET_RUN = 'run-leaflet';
/** A run the table no longer holds. */
const LOST_RUN = 'run-lost';
const OBSERVED = new Date('2026-10-05T06:00:00.000Z');
const EARLIER = new Date('2026-09-05T06:00:00.000Z');

const WEB = PriceSourceKind.OFFICIAL_WEB;
const LEAFLET = PriceSourceKind.OFFICIAL_LEAFLET;
const KINDS = [PriceSourceKind.OFFICIAL_API, WEB, LEAFLET];

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
    sourceKind: WEB,
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

/** The runs the harvester holds. `LOST_RUN` is not one of them. */
const RUNS = [
  { id: RUN, mode: HarvestRunMode.CATALOG_DISCOVERY, supermarketId: CHAIN },
  { id: OLD_RUN, mode: HarvestRunMode.CATALOG_DISCOVERY, supermarketId: CHAIN },
  {
    id: LEAFLET_RUN,
    mode: HarvestRunMode.FILE_IMPORT,
    supermarketId: CHAIN,
    input: { sourceKind: LEAFLET },
  },
] as unknown as HarvestRun[];

function build(bound: SourceCatalogEntry[]) {
  /** Every call to catalog, in order, by the name of what was called. */
  const calls: string[] = [];
  const find = jest.fn(async () => bound);
  const withdrawPrices = jest.fn(
    async (
      _itemId: string,
      _scopes: string[],
      _kinds: PriceSourceKind[],
      _held: HeldItemPrice[],
      _stated: StatedItemPrice[],
      _dryRun?: boolean
    ) => {
      calls.push('withdrawPrices');
      return {
        deleted: 3,
        removed: [{ priceScopeId: DEFAULT, sourceKind: WEB, deleted: 3 }],
        inserted: 1,
        confirmed: 0,
        keptAsWritten: [],
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
  const addPrices = jest.fn();
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
  const runs = {
    find: jest.fn(async () => RUNS),
  } as unknown as Repository<HarvestRun>;
  const sources = {
    find: jest.fn(async () => [
      { supermarketId: CHAIN, adapterKey: 'deza-web' },
    ]),
  } as unknown as Repository<SupermarketSource>;
  const settler = new SourceEntrySettler(entries, runs, sources, catalog);
  const heldOf = () => withdrawPrices.mock.calls[0][3];
  const statedOf = () => withdrawPrices.mock.calls[0][4];
  return {
    settler,
    find,
    withdrawPrices,
    withdrawOffers,
    addPrices,
    calls,
    heldOf,
    statedOf,
  };
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
      const { settler, withdrawPrices, withdrawOffers, calls } = build([]);

      const result = await settler.settle(ITEM, CHAIN);

      // Nothing is held and nothing is stated, so nothing is spared.
      expect(withdrawPrices).toHaveBeenCalledWith(
        ITEM,
        [DEFAULT, NORTH, SOUTH],
        KINDS,
        [],
        [],
        false
      );
      expect(withdrawOffers).toHaveBeenCalledWith(
        ITEM,
        CHAIN,
        [DEFAULT, NORTH, SOUTH],
        null
      );
      // The prices first: an offer goes only when nothing prices it.
      expect(calls).toEqual(['withdrawPrices', 'withdrawOffers']);
      expect(result).toEqual({
        itemId: ITEM,
        supermarketId: CHAIN,
        dryRun: false,
        boundEntryIds: [],
        pricesWithdrawn: 3,
        pricesWithdrawnAt: [
          { priceScopeId: DEFAULT, sourceKind: WEB, deleted: 3 },
        ],
        pricesRestated: 0,
        pricesWritten: 1,
        pricesKeptAsWritten: [],
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
    it('holds what the row holds, states its open price inside the one withdraw, and keeps every offer', async () => {
      const kept = row('0e539371', [price('0e539371', 2.45)]);
      const { settler, withdrawOffers, addPrices, calls, heldOf, statedOf } =
        build([kept]);

      const result = await settler.settle(ITEM, CHAIN);

      expect(heldOf()).toEqual([
        { priceScopeId: DEFAULT, sourceKind: WEB, sourceRunId: RUN },
      ]);
      // The 2.45 travels with its own run and its own instant.
      expect(statedOf()).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: WEB,
          sourceRunId: RUN,
          copiedFromScopeId: null,
          price: expect.objectContaining({
            price: 2.45,
            currency: 'EUR',
            observedAt: OBSERVED.toISOString(),
          }),
        },
      ]);
      // One message. The price is not sent on its own behind it, so there is
      // no moment between a delete and a write.
      expect(calls).toEqual(['withdrawPrices']);
      expect(addPrices).not.toHaveBeenCalled();
      // A chain that lists a product sells it: the offers are not asked about.
      expect(withdrawOffers).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        boundEntryIds: ['0e539371'],
        pricesRestated: 1,
        pricesWritten: 1,
        offersRemoved: [],
        shopRowsRemoved: 0,
      });
    });

    it('takes the kind of a price from its run, not from what the row says today', async () => {
      // A leaflet wrote the price. A website walk touched the shared row
      // since, so the row says OFFICIAL_WEB (plan 0190).
      const shared = row(
        'shared',
        [price('shared', 1.99, { runId: LEAFLET_RUN })],
        { sourceKind: WEB }
      );
      const { settler, heldOf, statedOf } = build([shared]);

      await settler.settle(ITEM, CHAIN);

      expect(heldOf()).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: LEAFLET,
          sourceRunId: LEAFLET_RUN,
        },
      ]);
      expect(statedOf()).toEqual([
        expect.objectContaining({
          priceScopeId: DEFAULT,
          sourceKind: LEAFLET,
          sourceRunId: LEAFLET_RUN,
        }),
      ]);
    });

    it('spares every kind at a scope, and states nothing there, when a price names no run it can read', async () => {
      const lost = row('lost', [
        price('lost', 1.99, { runId: LOST_RUN }),
        price('lost', 2.05, { priceScopeId: NORTH, runId: null }),
        price('lost', 2.1, { priceScopeId: SOUTH }),
      ]);
      const { settler, heldOf, statedOf } = build([lost]);

      const result = await settler.settle(ITEM, CHAIN);

      // A null kind is "every kind at this scope".
      expect(heldOf()).toEqual([
        { priceScopeId: DEFAULT, sourceKind: null, sourceRunId: LOST_RUN },
        { priceScopeId: NORTH, sourceKind: null, sourceRunId: null },
        { priceScopeId: SOUTH, sourceKind: WEB, sourceRunId: RUN },
      ]);
      // Only the price whose kind is known is stated.
      expect(statedOf()).toEqual([
        expect.objectContaining({ priceScopeId: SOUTH, sourceKind: WEB }),
      ]);
      expect(result.pricesRestated).toBe(1);
    });

    it('states no price of a known kind at a scope where another bound price has none', async () => {
      const known = row('known', [price('known', 1.99)]);
      const lost = row('lost', [price('lost', 1.99, { runId: LOST_RUN })]);
      const { settler, heldOf, statedOf } = build([known, lost]);

      await settler.settle(ITEM, CHAIN);

      expect(heldOf()).toEqual(
        expect.arrayContaining([
          { priceScopeId: DEFAULT, sourceKind: WEB, sourceRunId: RUN },
          { priceScopeId: DEFAULT, sourceKind: null, sourceRunId: LOST_RUN },
        ])
      );
      expect(statedOf()).toEqual([]);
    });

    it('states the newest observation when the rows agree on the amount', async () => {
      // The row decided first is one the chain stopped listing. It keeps an
      // old price of the same amount, from an old run.
      const delisted = row(
        'delisted',
        [price('delisted', 2.45, { runId: OLD_RUN, observedAt: EARLIER })],
        { decidedAt: new Date('2026-08-01T00:00:00.000Z') }
      );
      const live = row('live', [price('live', 2.45)]);
      const { settler, statedOf } = build([delisted, live]);

      await settler.settle(ITEM, CHAIN);

      expect(statedOf()).toEqual([
        expect.objectContaining({
          sourceRunId: RUN,
          price: expect.objectContaining({
            price: 2.45,
            observedAt: OBSERVED.toISOString(),
          }),
        }),
      ]);
    });

    it('holds everything and states nothing where two rows state two amounts', async () => {
      const small = row('small', [price('small', 2.45)], {
        decidedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      const king = row('king', [
        price('king', 2.95),
        price('king', 3.05, { priceScopeId: NORTH }),
      ]);
      const { settler, heldOf, statedOf } = build([small, king]);

      const result = await settler.settle(ITEM, CHAIN);

      // The shared scope is held and not stated. The price that was current
      // before the conflict stays and ages.
      expect(heldOf()).toEqual([
        { priceScopeId: DEFAULT, sourceKind: WEB, sourceRunId: RUN },
        { priceScopeId: NORTH, sourceKind: WEB, sourceRunId: RUN },
      ]);
      // Only the scope one row prices is stated.
      expect(statedOf()).toEqual([
        expect.objectContaining({
          priceScopeId: NORTH,
          price: expect.objectContaining({ price: 3.05 }),
        }),
      ]);
      expect(result.pricesRestated).toBe(1);
      expect(result.pricesWithheld).toEqual([
        { entryId: 'small', priceScopeId: DEFAULT, otherEntryIds: ['king'] },
        { entryId: 'king', priceScopeId: DEFAULT, otherEntryIds: ['small'] },
      ]);
    });

    it('holds a price whose window closed, so its history stays, and states nothing for it', async () => {
      const kept = row('kept', [
        price('kept', 1.99, {
          runId: LEAFLET_RUN,
          validUntil: new Date('2020-01-01T00:00:00.000Z'),
        }),
        price('kept', 2.1, { priceScopeId: GONE }),
      ]);
      const { settler, heldOf, statedOf } = build([kept]);

      const result = await settler.settle(ITEM, CHAIN);

      // The leaflet that ended is still accounted for. The scope catalog no
      // longer holds is not named at all.
      expect(heldOf()).toEqual([
        {
          priceScopeId: DEFAULT,
          sourceKind: LEAFLET,
          sourceRunId: LEAFLET_RUN,
        },
      ]);
      expect(statedOf()).toEqual([]);
      expect(result.pricesRestated).toBe(0);
    });

    it('states nothing where a bound row holds a closed price as new as the open one', async () => {
      // Stating the open price would remove the row of the closed one, and
      // that row is a bound row's own history.
      const open = row('open', [
        price('open', 2.45, { runId: OLD_RUN, observedAt: EARLIER }),
      ]);
      const closed = row('closed', [
        price('closed', 1.99, {
          validUntil: new Date('2026-10-05T23:00:00.000Z'),
        }),
      ]);
      const { settler, heldOf, statedOf } = build([open, closed]);

      await settler.settle(ITEM, CHAIN);

      expect(heldOf()).toHaveLength(2);
      expect(statedOf()).toEqual([]);
    });

    it('answers what catalog kept under the kind it was written with', async () => {
      const kept = row('kept', [price('kept', 1.99, { runId: LEAFLET_RUN })]);
      const { settler, withdrawPrices } = build([kept]);
      withdrawPrices.mockResolvedValueOnce({
        deleted: 0,
        removed: [],
        inserted: 0,
        confirmed: 0,
        keptAsWritten: [
          { priceScopeId: DEFAULT, sourceKind: LEAFLET, heldAs: WEB },
        ],
        recomputed: 0,
      } as never);

      const result = await settler.settle(ITEM, CHAIN);

      expect(result.pricesKeptAsWritten).toEqual([
        { priceScopeId: DEFAULT, sourceKind: LEAFLET, heldAs: WEB },
      ]);
      // It was stated and not applied, so it does not count as restated.
      expect(result.pricesRestated).toBe(0);
      expect(result.pricesWritten).toBe(0);
    });
  });

  describe('a dry run', () => {
    it('asks catalog the same question with dryRun, and nothing else', async () => {
      const kept = row('kept', [price('kept', 2.45)]);
      const { settler, withdrawPrices, calls, statedOf } = build([kept]);

      const result = await settler.settle(ITEM, CHAIN, { dryRun: true });

      expect(withdrawPrices.mock.calls[0][5]).toBe(true);
      expect(statedOf()).toHaveLength(1);
      expect(calls).toEqual(['withdrawPrices']);
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
