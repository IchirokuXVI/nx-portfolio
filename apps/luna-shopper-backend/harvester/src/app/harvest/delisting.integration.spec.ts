import {
  PriceSourceKind,
  SourceEntryStatus,
  type SupermarketItemAvailabilityEntry,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
  SourceEntryScopePresence,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { readDelistingThreshold } from './delisting';
import { DelistingService, type DelistingInput } from './delisting.service';
import type { RunScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import { RunReportSink } from './run-report.sink';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';

/**
 * The delisting counter against real Postgres (plan 0220, the Tests section).
 *
 * Every step is set based SQL over arrays, and the shapes a fake cannot prove
 * are the point: `unnest` of a uuid array, `ON CONFLICT` on the pair,
 * `UPDATE ... RETURNING` through a `WITH`, and the guard that makes a retry
 * count once. Catalog is another service, so it is a recording double here;
 * its half (`delisted`, `outOfStock`, `keptSold`) is
 * `supermarket-item-delisting.integration.spec.ts` in catalog.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration --testFile=delisting.integration.spec.ts
 */
describeIntegration('the delisting counter (real Postgres)', () => {
  /** Two chains nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '0220c0de-0000-4000-8000-000000000001';
  const OTHER_CHAIN = '0220c0de-0000-4000-8000-000000000002';
  const S1 = '0220c0de-0000-4000-8000-0000000000a1';
  const S2 = '0220c0de-0000-4000-8000-0000000000a2';
  const COPY = '0220c0de-0000-4000-8000-0000000000c1';
  const OTHER_SCOPE = '0220c0de-0000-4000-8000-0000000000b1';
  const ITEM = (n: number) =>
    `0220c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const RUN = (n: number) =>
    `0220c0de-0000-4000-8000-${String(9000 + n).padStart(12, '0')}`;
  const KIND = PriceSourceKind.OFFICIAL_API;
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = new Date('2026-10-01T03:00:00.000Z');
  const day = (n: number) => new Date(T0.getTime() + n * DAY);

  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let prices: Repository<SourceEntryPrice>;
  let presence: Repository<SourceEntryScopePresence>;

  /** What catalog was told, per call, and whether the next call fails. */
  let told: { scopeId: string; entries: SupermarketItemAvailabilityEntry[] }[];
  let failNext: boolean;
  const catalog = {
    setAvailability: async (
      scopeId: string,
      batch: SupermarketItemAvailabilityEntry[]
    ) => {
      if (failNext) {
        failNext = false;
        throw new Error('catalog is down');
      }
      told.push({ scopeId, entries: batch });
      return { updated: batch.length, keptSold: 0 };
    },
    getSupermarket: async () => ({ defaultPriceScopeId: null }),
  } as unknown as CatalogClient;

  let counter: DelistingService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    entries = dataSource.getRepository(SourceCatalogEntry);
    prices = dataSource.getRepository(SourceEntryPrice);
    presence = dataSource.getRepository(SourceEntryScopePresence);
    counter = new DelistingService(presence, catalog);
  });

  beforeEach(async () => {
    told = [];
    failNext = false;
    await clean();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  async function clean(): Promise<void> {
    // The presence and price rows go with their entries, by the cascades.
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = ANY($1::uuid[])`,
      [[CHAIN, OTHER_CHAIN]]
    );
  }

  /** One row of a chain, `ACTIVE` on an item when one is given. */
  async function entry(
    externalId: string,
    over: {
      itemId?: string;
      supermarketId?: string;
      status?: SourceEntryStatus;
      sourceKind?: PriceSourceKind;
    } = {}
  ): Promise<SourceCatalogEntry> {
    return entries.save(
      entries.create({
        supermarketId: over.supermarketId ?? CHAIN,
        externalId,
        sourceKind: over.sourceKind ?? KIND,
        name: `Product ${externalId}`,
        itemId: over.itemId ?? null,
        status:
          over.status ??
          (over.itemId
            ? SourceEntryStatus.ACTIVE
            : SourceEntryStatus.UNRESOLVED),
      })
    );
  }

  /** A price a walk read at a scope, or a copy of one. */
  async function price(
    row: SourceCatalogEntry,
    scopeId: string,
    over: { copiedFromScopeId?: string; sourceKind?: PriceSourceKind } = {}
  ): Promise<void> {
    await prices.save(
      prices.create({
        entryId: row.id,
        priceScopeId: scopeId,
        sourceKind: over.sourceKind ?? KIND,
        price: 1.5,
        copiedFromScopeId: over.copiedFromScopeId ?? null,
      })
    );
  }

  /** One counted run of the chain over these whole listings. */
  function count(
    run: number,
    at: Date,
    listings: Array<{ scopeId: string; listed: string[] }>,
    over: Partial<DelistingInput> = {}
  ) {
    return counter.count(
      {
        runId: RUN(run),
        supermarketId: CHAIN,
        sourceKind: KIND,
        whole: listings.map((listing) => ({ key: null, ...listing })),
        notWhole: [],
        threshold: readDelistingThreshold({}),
        ...over,
      },
      at
    );
  }

  const pairOf = (row: SourceCatalogEntry, scopeId: string) =>
    presence.findOne({ where: { entryId: row.id, priceScopeId: scopeId } });

  it('seeds a scope from the prices it read itself, of the run kind, and nothing else', async () => {
    const read = await entry('read');
    const copied = await entry('copied');
    const leaflet = await entry('leaflet');
    const elsewhere = await entry('elsewhere');
    await price(read, S1);
    // A copy writes a row at its target, and a copy target never listed it.
    await price(copied, S1, { copiedFromScopeId: S2 });
    await price(leaflet, S1, { sourceKind: PriceSourceKind.OFFICIAL_LEAFLET });
    await price(elsewhere, S2);

    const report = await count(1, day(0), [{ scopeId: S1, listed: [] }]);

    expect(report.scopes[0]).toMatchObject({ seeded: 1, missed: 1 });
    expect(await pairOf(read, S1)).toMatchObject({ missedWalks: 1 });
    expect(await pairOf(copied, S1)).toBeNull();
    expect(await pairOf(leaflet, S1)).toBeNull();
    expect(await pairOf(elsewhere, S1)).toBeNull();
  });

  it('marks out of stock on the first miss, and gone after three counted misses over fourteen days, once', async () => {
    const row = await entry('p', { itemId: ITEM(1) });
    await count(1, day(0), [{ scopeId: S1, listed: ['p'] }]);
    expect(told).toEqual([]);

    const first = await count(2, day(7), [{ scopeId: S1, listed: [] }]);
    expect(first.scopes[0]).toMatchObject({ missed: 1, newlyOutOfStock: 1 });
    // The first miss hides nothing.
    expect(told).toEqual([
      {
        scopeId: S1,
        entries: [{ itemId: ITEM(1), available: true, outOfStock: true }],
      },
    ]);

    await count(3, day(14), [{ scopeId: S1, listed: [] }]);
    const third = await count(4, day(21), [{ scopeId: S1, listed: [] }]);
    expect(third.scopes[0].newlyGone).toBe(1);
    expect(told.at(-1)).toEqual({
      scopeId: S1,
      entries: [{ itemId: ITEM(1), available: false, delisted: true }],
    });
    const gone = await pairOf(row, S1);
    expect(gone).toMatchObject({ missedWalks: 3, pendingCatalog: false });
    expect(gone?.goneAt?.toISOString()).toBe(day(21).toISOString());
    expect(
      (await entries.findOneByOrFail({ id: row.id })).delistedAt?.toISOString()
    ).toBe(day(21).toISOString());

    // A fourth miss makes no second transition and tells catalog nothing.
    const sent = told.length;
    const fourth = await count(5, day(28), [{ scopeId: S1, listed: [] }]);
    expect(fourth.scopes[0]).toMatchObject({ newlyGone: 0, missed: 1 });
    expect(told).toHaveLength(sent);
    expect((await pairOf(row, S1))?.goneAt?.toISOString()).toBe(
      day(21).toISOString()
    );
  });

  it('does not make a pair gone for three misses in three days', async () => {
    const row = await entry('p', { itemId: ITEM(1) });
    await count(1, day(0), [{ scopeId: S1, listed: ['p'] }]);
    for (const n of [1, 2, 3]) {
      await count(1 + n, day(n), [{ scopeId: S1, listed: [] }]);
    }

    expect(await pairOf(row, S1)).toMatchObject({
      missedWalks: 3,
      goneAt: null,
    });
  });

  it('brings a gone pair back on a counted run that lists it, and tells catalog', async () => {
    const row = await entry('p', { itemId: ITEM(1) });
    await count(1, day(0), [{ scopeId: S1, listed: ['p'] }]);
    for (const n of [1, 2, 3]) {
      await count(1 + n, day(7 * n), [{ scopeId: S1, listed: [] }]);
    }
    expect((await pairOf(row, S1))?.goneAt).not.toBeNull();
    told = [];

    const back = await count(5, day(28), [{ scopeId: S1, listed: ['p'] }]);

    expect(back.scopes[0].cameBack).toBe(1);
    expect(back.entriesBack).toBe(1);
    expect(await pairOf(row, S1)).toMatchObject({
      missedWalks: 0,
      firstMissedAt: null,
      goneAt: null,
      pendingCatalog: false,
      lastCountedRunId: RUN(5),
    });
    expect(told).toEqual([
      {
        scopeId: S1,
        entries: [
          {
            itemId: ITEM(1),
            available: true,
            delisted: false,
            outOfStock: false,
          },
        ],
      },
    ]);
    expect(
      (await entries.findOneByOrFail({ id: row.id })).delistedAt
    ).toBeNull();
  });

  it('counts the same run once, however often it is counted', async () => {
    const row = await entry('p', { itemId: ITEM(1) });
    await count(1, day(0), [{ scopeId: S1, listed: ['p'] }]);

    await count(2, day(7), [{ scopeId: S1, listed: [] }]);
    const retry = await count(2, day(7), [{ scopeId: S1, listed: [] }]);

    expect(retry.scopes[0].missed).toBe(0);
    expect((await pairOf(row, S1))?.missedWalks).toBe(1);
  });

  it('never misses a product at a scope that never listed it', async () => {
    const row = await entry('only-s2', { itemId: ITEM(1) });
    await count(1, day(0), [
      { scopeId: S1, listed: [] },
      { scopeId: S2, listed: ['only-s2'] },
    ]);
    for (const n of [1, 2, 3]) {
      await count(1 + n, day(7 * n), [
        { scopeId: S1, listed: [] },
        { scopeId: S2, listed: ['only-s2'] },
      ]);
    }

    expect(await pairOf(row, S1)).toBeNull();
    expect(await pairOf(row, S2)).toMatchObject({ missedWalks: 0 });
    expect(told).toEqual([]);
  });

  it('sets delistedAt on the row when every pair is gone, and clears it when one comes back', async () => {
    const row = await entry('p', { itemId: ITEM(1) });
    const both = (listed: string[]) => [
      { scopeId: S1, listed },
      { scopeId: S2, listed },
    ];
    await count(1, day(0), both(['p']));
    // Gone at S1 only: S2 keeps listing it.
    for (const n of [1, 2, 3]) {
      await count(1 + n, day(7 * n), [
        { scopeId: S1, listed: [] },
        { scopeId: S2, listed: ['p'] },
      ]);
    }
    expect((await pairOf(row, S1))?.goneAt).not.toBeNull();
    expect(
      (await entries.findOneByOrFail({ id: row.id })).delistedAt
    ).toBeNull();

    for (const n of [4, 5, 6]) {
      await count(1 + n, day(7 * n), both([]));
    }
    const delisted = await entries.findOneByOrFail({ id: row.id });
    expect(delisted.delistedAt?.toISOString()).toBe(day(42).toISOString());

    const back = await count(8, day(49), [{ scopeId: S2, listed: ['p'] }]);
    expect(back.entriesBack).toBe(1);
    expect(
      (await entries.findOneByOrFail({ id: row.id })).delistedAt
    ).toBeNull();
    // S1 was not walked, so it stays gone there.
    expect((await pairOf(row, S1))?.goneAt).not.toBeNull();
  });

  it('sends a product gone only when every ACTIVE row on it is gone (section 6.2)', async () => {
    const first = await entry('a', { itemId: ITEM(1) });
    const second = await entry('b', { itemId: ITEM(1) });
    await count(1, day(0), [{ scopeId: S1, listed: ['a', 'b'] }]);
    // `a` goes, `b` stays listed for three walks.
    for (const n of [1, 2, 3]) {
      await count(1 + n, day(7 * n), [{ scopeId: S1, listed: ['b'] }]);
    }
    expect((await pairOf(first, S1))?.goneAt).not.toBeNull();
    // The product is still sold through `b`, so nothing was sent for it.
    expect(told).toEqual([]);
    expect((await pairOf(first, S1))?.pendingCatalog).toBe(false);

    for (const n of [4, 5, 6]) {
      await count(1 + n, day(7 * n), [{ scopeId: S1, listed: [] }]);
    }
    expect((await pairOf(second, S1))?.goneAt).not.toBeNull();
    expect(told.map((call) => call.entries)).toEqual([
      // `b`'s first miss, with `a` already gone: out of stock.
      [{ itemId: ITEM(1), available: true, outOfStock: true }],
      [{ itemId: ITEM(1), available: false, delisted: true }],
    ]);
  });

  it('keeps a pair pending when catalog refused the batch, and sends it on the next counted run', async () => {
    const row = await entry('p', { itemId: ITEM(1) });
    await count(1, day(0), [{ scopeId: S1, listed: ['p'] }]);

    failNext = true;
    const refused = await count(2, day(7), [{ scopeId: S1, listed: [] }]);
    expect(refused.catalogFailed).toBe(1);
    expect((await pairOf(row, S1))?.pendingCatalog).toBe(true);

    const next = await count(3, day(14), [{ scopeId: S1, listed: [] }]);
    expect(next.catalogSent).toBe(1);
    expect(told).toEqual([
      {
        scopeId: S1,
        entries: [{ itemId: ITEM(1), available: true, outOfStock: true }],
      },
    ]);
    expect((await pairOf(row, S1))?.pendingCatalog).toBe(false);
  });

  it('acknowledges a pair whose row is not ACTIVE without a call, and writes the copies', async () => {
    const queued = await entry('queued');
    const bound = await entry('bound', { itemId: ITEM(2) });
    await count(1, day(0), [{ scopeId: S1, listed: ['queued', 'bound'] }]);

    await count(2, day(7), [{ scopeId: S1, listed: [] }], {
      copiesOf: (scopeId) => (scopeId === S1 ? [COPY] : []),
    });

    expect((await pairOf(queued, S1))?.pendingCatalog).toBe(false);
    expect((await pairOf(bound, S1))?.pendingCatalog).toBe(false);
    expect(told.map((call) => call.scopeId)).toEqual([S1, COPY]);
    expect(told.every((call) => call.entries.length === 1)).toBe(true);
  });

  it('changes nothing of another chain that holds the same product (section 15.7)', async () => {
    const mine = await entry('p', { itemId: ITEM(1) });
    const theirs = await entry('p', {
      itemId: ITEM(1),
      supermarketId: OTHER_CHAIN,
    });
    await price(theirs, OTHER_SCOPE);
    await price(mine, S1);
    const snapshot = async () =>
      JSON.stringify(
        await dataSource.query(
          `SELECT e.*, (SELECT json_agg(p ORDER BY p."id") FROM "source_entry_prices" p WHERE p."entryId" = e."id") AS "prices",
                  (SELECT json_agg(s ORDER BY s."id") FROM "source_entry_scope_presence" s WHERE s."entryId" = e."id") AS "presence"
             FROM "source_catalog_entries" e WHERE e."supermarketId" = $1`,
          [OTHER_CHAIN]
        )
      );
    const before = await snapshot();

    for (const n of [0, 1, 2, 3]) {
      await count(1 + n, day(7 * n), [{ scopeId: S1, listed: [] }]);
    }

    expect((await pairOf(mine, S1))?.goneAt).not.toBeNull();
    expect(await snapshot()).toBe(before);
    expect(told.every((call) => call.scopeId === S1)).toBe(true);
  });

  describe('the scope diff of the sink reads the same tables (section 3)', () => {
    /** A sink over the real rows, that drains a whole listing of S1. */
    async function drain(listed: string[]) {
      const context = {
        runId: RUN(99),
        report: async () => undefined,
      } as unknown as RunContext;
      const sink = new RunReportSink(
        context,
        {
          supermarketId: CHAIN,
          defaultPriceScopeId: S1,
          sourceKind: KIND,
          postalCodeDeriveMaxMetres: 5000,
          autoImportPlaces: false,
          provesDelisting: true,
        },
        {
          ingest: {} as never,
          scopes: {
            createdCount: 0,
            idFor: () => null,
          } as unknown as RunScopeResolver,
          places: {} as never,
          shops: {} as never,
          catalog,
          entries,
          availability: {} as never,
        }
      );
      sink.listingWhole(null, listed);
      await sink.drain();
    }

    it('writes no negative on the first counted run after the migration for a product the scope read a price for', async () => {
      // No presence row yet: the counter has never run. The price is what
      // says this scope once listed it.
      const priced = await entry('priced', { itemId: ITEM(1) });
      await price(priced, S1);
      expect(await pairOf(priced, S1)).toBeNull();

      await drain([]);

      expect(told).toEqual([]);
    });

    it('writes not sold for a product the scope never listed, priced elsewhere or copied here', async () => {
      const elsewhere = await entry('elsewhere', { itemId: ITEM(1) });
      await price(elsewhere, S2);
      const copied = await entry('copied', { itemId: ITEM(2) });
      await price(copied, S1, { copiedFromScopeId: S2 });

      await drain([]);

      expect(told).toEqual([
        {
          scopeId: S1,
          entries: expect.arrayContaining([
            { itemId: ITEM(1), available: false },
            { itemId: ITEM(2), available: false },
          ]),
        },
      ]);
    });

    it('writes nothing for a product with a presence row here', async () => {
      const counted = await entry('counted', { itemId: ITEM(1) });
      await count(1, day(0), [{ scopeId: S1, listed: ['counted'] }]);
      expect(await pairOf(counted, S1)).not.toBeNull();

      await drain([]);

      expect(told).toEqual([]);
    });
  });

  it('sends the gone statement when a person binds a row a walk proved gone (section 6.4)', async () => {
    const row = await entry('p');
    await count(1, day(0), [{ scopeId: S1, listed: ['p'] }]);
    for (const n of [1, 2, 3]) {
      await count(1 + n, day(7 * n), [{ scopeId: S1, listed: [] }]);
    }
    // Not ACTIVE, so catalog was told nothing.
    expect(told).toEqual([]);

    row.itemId = ITEM(3);
    row.status = SourceEntryStatus.ACTIVE;
    await entries.save(row);
    const writer = new SourceEntryAvailabilityWriter(
      dataSource.getRepository(SourceEntryAvailability),
      catalog
    );
    await writer.writeForEntries([row]);

    expect(told).toEqual([
      {
        scopeId: S1,
        entries: [{ itemId: ITEM(3), available: false, delisted: true }],
      },
    ]);
  });
});
