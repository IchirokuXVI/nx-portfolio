import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  type ItemPriceBatchEntry,
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
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';
import { RunReportSink } from './run-report.sink';
import { bindFields } from './source-entry-write';
import { SourceIngest, type SourceObservation } from './source-ingest';

/**
 * A walk never undoes a decision, and a failed write stops the run (plan
 * 0269), against real Postgres.
 *
 * A real `SourceIngest` and a real `RunReportSink`, a recorder for catalog,
 * and a chain nothing else in this database uses. Each case reports a first
 * chunk of 400 products, which the sink writes as soon as it is full, lets it
 * settle, writes a person's decision between the chunks the way the queue
 * does, and then reports the second chunk and drains.
 *
 * A mocked repository cannot prove any of this. Before the plan the walk
 * wrote back a cached entity with `save`, and `save` diffs the entity against
 * what the database holds now: only a real database shows that this put the
 * cached decision back over the person's. The guarded writes answer their
 * row count, and only Postgres says what that count is.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=walk-keeps-decisions.integration.spec.ts
 */
describeIntegration(
  'a walk never undoes a decision, and a failed write stops the run (real Postgres)',
  () => {
    /** A chain nothing else in this database uses, so cleanup is exact. */
    const CHAIN = '02690269-0000-4000-8000-111111111111';
    const SCOPE = '02690269-0000-4000-8000-222222222222';
    const RUN = '02690269-0000-4000-8000-333333333333';
    const ITEM_ACCEPTED = '02690269-0000-4000-8000-444444444401';
    const ITEM_REJECTED = '02690269-0000-4000-8000-444444444402';
    const ITEM_LEFT = '02690269-0000-4000-8000-444444444403';
    const ITEM_BARCODE = '02690269-0000-4000-8000-444444444404';
    const ITEM_PRICED = '02690269-0000-4000-8000-444444444405';
    const ITEM_SHARED = '02690269-0000-4000-8000-444444444406';
    const ITEM_PACK_LEFT = '02690269-0000-4000-8000-444444444407';
    const ITEM_PACK_KEPT = '02690269-0000-4000-8000-444444444408';

    const EAN_REJECTED = '8410000000016';
    const EAN_BARCODE = '8410000000023';
    const EAN_SHARED = '8410000000030';

    /** The size of one chunk of the sink, `PRODUCT_CHUNK`. */
    const CHUNK = 400;

    let dataSource: DataSource;
    let entries: Repository<SourceCatalogEntry>;
    let prices: Repository<SourceEntryPrice>;

    /** What catalog was sent. */
    let sent: { itemId: string; price: number | null | undefined }[];
    let told: SupermarketItemAvailabilityEntry[];
    /** When set, `addPrices` rejects with it, once. */
    let pricesFail: Error | null;
    let pricesCalls: number;
    /** The pack counts and the weights the drain sent (plan 0269, D8). */
    let filled: { itemId: string; packCount: number }[];
    let weighed: { itemId: string; approxWeight: number }[];

    const catalog = {
      searchItems: async () => ({
        items: [
          item(ITEM_REJECTED, 'Producto rechazado', EAN_REJECTED),
          item(ITEM_BARCODE, 'Producto con barras', EAN_BARCODE),
          item(ITEM_SHARED, 'Producto compartido', EAN_SHARED),
        ],
        nextCursor: null,
      }),
      addPrices: async (_scope: string, batch: ItemPriceBatchEntry[]) => {
        pricesCalls += 1;
        if (pricesFail) {
          const failure = pricesFail;
          pricesFail = null;
          throw failure;
        }
        for (const each of batch) {
          sent.push({ itemId: each.itemId, price: each.price });
        }
        return { inserted: batch.length, confirmed: 0 };
      },
      linkItemImages: async () => ({
        linked: 0,
        moved: 0,
        unchanged: 0,
        rejected: [],
      }),
      unlinkItemImages: async () => ({ unlinked: 0 }),
      setAvailability: async (
        _scope: string,
        batch: SupermarketItemAvailabilityEntry[]
      ) => {
        told.push(...batch);
        return { updated: batch.length };
      },
      fillPackCounts: async (
        batch: { itemId: string; packCount: number }[]
      ) => {
        filled.push(...batch);
        return { written: batch.length };
      },
      setApproxWeights: async (
        batch: { itemId: string; approxWeight: number }[]
      ) => {
        weighed.push(...batch);
        return {
          written: batch.length,
          skippedSetByAdmin: 0,
          skippedHasSize: 0,
        };
      },
    } as unknown as CatalogClient;

    function item(id: string, name: string, ean: string) {
      return {
        id,
        name: { es: name, en: null },
        brand: null,
        ean,
        unitSize: null,
      };
    }

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
    });

    beforeEach(async () => {
      sent = [];
      told = [];
      pricesFail = null;
      pricesCalls = 0;
      filled = [];
      weighed = [];
      await clean();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await clean();
        await dataSource.destroy();
      }
    });

    async function clean(): Promise<void> {
      // The prices go with their rows, by the cascade.
      await dataSource.query(
        `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
        [CHAIN]
      );
    }

    /** A row the chain held before the walk. */
    async function seed(
      over: Partial<SourceCatalogEntry> & { externalId: string; name: string }
    ): Promise<SourceCatalogEntry> {
      return entries.save(
        entries.create({
          supermarketId: CHAIN,
          sourceKind: PriceSourceKind.OFFICIAL_API,
          brand: null,
          ean: null,
          unitSize: null,
          sizeFormat: null,
          categoryPath: [],
          url: null,
          extra: null,
          timesSeen: 1,
          status: SourceEntryStatus.UNRESOLVED,
          itemId: null,
          candidateEntryId: null,
          matchedBy: null,
          confidence: 0,
          decidedAt: null,
          ...over,
        })
      );
    }

    const row = (externalId: string) =>
      entries.findOneOrFail({ where: { supermarketId: CHAIN, externalId } });

    /** What `SourceEntryService.accept` writes, through its own field rule. */
    async function accept(externalId: string, itemId: string): Promise<void> {
      await entries.save(bindFields(await row(externalId), itemId));
    }

    /** What `SourceEntryService.reject` writes. */
    async function reject(externalId: string): Promise<void> {
      const held = await row(externalId);
      held.status = SourceEntryStatus.REJECTED;
      held.itemId = null;
      held.candidateEntryId = null;
      held.matchedBy = ItemSourceMatch.MANUAL;
      held.confidence = 1;
      held.decidedAt = new Date();
      await entries.save(held);
    }

    function product(
      externalId: string,
      over: Partial<SourceObservation> = {}
    ): SourceObservation {
      return {
        externalId,
        name: `Producto ${externalId}`,
        brand: null,
        ean: null,
        unitSize: null,
        sizeUnit: null,
        sizeFormat: null,
        categoryPath: ['Bebidas', 'Agua'],
        url: null,
        imageUrl: null,
        observedAt: new Date('2026-11-11T10:00:00.000Z'),
        extra: { page: 1 },
        prices: [
          {
            scopeKey: null,
            price: 1.25,
            currency: 'EUR',
            unitPrice: null,
            unitPriceLabel: null,
            validFrom: null,
            validUntil: null,
          },
        ],
        ...over,
      };
    }

    /** Products nobody decided, to fill a chunk. */
    const fillers = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, n) =>
        product(`${prefix}-${n}`, { name: `Relleno ${prefix} ${n}` })
      );

    const onWriteFailed = jest.fn();

    function sink(): RunReportSink {
      onWriteFailed.mockReset();
      const context = {
        runId: RUN,
        report: async () => undefined,
        advance: async () => undefined,
        warn: () => undefined,
      } as unknown as RunContext;
      const deps = {
        ingest: new SourceIngest(entries, prices, catalog),
        scopes: null,
        places: {} as never,
        shops: {} as never,
        catalog,
        entries,
        availability: {
          store: async () => 0,
          writeForRun: async () => ({ written: 0, shops: 0, conflicts: [] }),
          countsForRun: async () => ({
            stored: 0,
            written: 0,
            waitingForBinding: 0,
            waitingForShop: 0,
          }),
          writePricelessOffersForRun: async () => ({ written: 0, failed: 0 }),
        } as never,
        onWriteFailed,
      };
      return new RunReportSink(
        context,
        {
          supermarketId: CHAIN,
          defaultPriceScopeId: SCOPE,
          sourceKind: PriceSourceKind.OFFICIAL_API,
          postalCodeDeriveMaxMetres: 5000,
          autoImportPlaces: false,
        },
        deps
      );
    }

    /** Wait for every write the sink queued, as the walk's next page would. */
    const settled = (report: RunReportSink) =>
      (report as unknown as { chain: Promise<void> }).chain;

    const report = (into: RunReportSink, products: SourceObservation[]) => {
      for (const each of products) {
        into.product(each);
      }
    };

    const pricedFor = (itemId: string) =>
      sent.filter((each) => each.itemId === itemId);

    it('keeps an accept made during the walk, and the prices of the second chunk go to the product the person chose', async () => {
      await seed({ externalId: 'accepted', name: 'Producto aceptado' });
      const walk = sink();

      report(walk, fillers('one', CHUNK));
      await settled(walk);
      // The session read the row UNRESOLVED at its open.
      await accept('accepted', ITEM_ACCEPTED);

      report(walk, [product('accepted')]);
      walk.assortmentComplete(null);
      await walk.drain();

      expect(await row('accepted')).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        matchedBy: ItemSourceMatch.MANUAL,
        itemId: ITEM_ACCEPTED,
        // The walk's own columns moved, the count one up in the statement.
        timesSeen: 2,
        lastRunId: RUN,
        categoryPath: ['Bebidas', 'Agua'],
        extra: { page: 1 },
      });
      expect(Number((await row('accepted')).confidence)).toBe(1);
      expect(pricedFor(ITEM_ACCEPTED)).toEqual([
        { itemId: ITEM_ACCEPTED, price: 1.25 },
      ]);
      expect(told).toContainEqual({ itemId: ITEM_ACCEPTED, available: true });
    }, 120_000);

    it('keeps a reject made during the walk, writes no price after it, and states no availability for the product it left', async () => {
      await seed({
        externalId: 'rejected',
        name: 'Producto rechazado',
        ean: EAN_REJECTED,
        status: SourceEntryStatus.ACTIVE,
        itemId: ITEM_REJECTED,
        matchedBy: ItemSourceMatch.EAN,
        confidence: 1,
        decidedAt: new Date('2026-11-01T00:00:00.000Z'),
      });
      // Bound by a person, read in the first chunk only.
      await seed({
        externalId: 'left',
        name: 'Producto abandonado',
        status: SourceEntryStatus.ACTIVE,
        itemId: ITEM_LEFT,
        matchedBy: ItemSourceMatch.MANUAL,
        confidence: 1,
        decidedAt: new Date('2026-11-01T00:00:00.000Z'),
      });
      const walk = sink();

      report(walk, [
        product('rejected', { name: 'Producto rechazado', ean: EAN_REJECTED }),
        product('left', { name: 'Producto abandonado' }),
        ...fillers('one', CHUNK - 2),
      ]);
      await settled(walk);
      expect(pricedFor(ITEM_REJECTED)).toHaveLength(1);
      expect(pricedFor(ITEM_LEFT)).toHaveLength(1);
      await reject('rejected');
      await reject('left');

      report(walk, [
        product('rejected', { name: 'Producto rechazado', ean: EAN_REJECTED }),
      ]);
      walk.assortmentComplete(null);
      await walk.drain();

      expect(await row('rejected')).toMatchObject({
        status: SourceEntryStatus.REJECTED,
        matchedBy: ItemSourceMatch.MANUAL,
        itemId: null,
      });
      expect(await row('left')).toMatchObject({
        status: SourceEntryStatus.REJECTED,
        itemId: null,
      });
      // The price of the first chunk, and none from the second.
      expect(pricedFor(ITEM_REJECTED)).toHaveLength(1);
      // Neither product it left is stated in stock by the drain.
      expect(told.filter((each) => each.itemId === ITEM_REJECTED)).toEqual([]);
      expect(told.filter((each) => each.itemId === ITEM_LEFT)).toEqual([]);
    }, 120_000);

    it('sends no pack count and no weight to the product a row left after its chunk (D8)', async () => {
      // Two rows a person bound before the walk. One is rejected after its
      // chunk was written; the other is the control, which nobody touched.
      for (const [externalId, itemId] of [
        ['pack-left', ITEM_PACK_LEFT],
        ['pack-kept', ITEM_PACK_KEPT],
      ]) {
        await seed({
          externalId,
          name: `Producto ${externalId}`,
          status: SourceEntryStatus.ACTIVE,
          itemId,
          matchedBy: ItemSourceMatch.MANUAL,
          confidence: 1,
          decidedAt: new Date('2026-11-01T00:00:00.000Z'),
        });
      }
      const walk = sink();

      report(walk, [
        product('pack-left', {
          name: 'Producto pack-left',
          packCount: 6,
          approxWeight: 250,
        }),
        product('pack-kept', {
          name: 'Producto pack-kept',
          packCount: 4,
          approxWeight: 300,
        }),
        ...fillers('one', CHUNK - 2),
      ]);
      await settled(walk);
      await reject('pack-left');

      report(walk, fillers('two', 1));
      walk.assortmentComplete(null);
      await walk.drain();

      expect(filled).toEqual([{ itemId: ITEM_PACK_KEPT, packCount: 4 }]);
      expect(weighed).toEqual([{ itemId: ITEM_PACK_KEPT, approxWeight: 300 }]);
    }, 120_000);

    it('states in the result of a walk whose third chunk failed what the first two chunks wrote, and never the third (D9)', async () => {
      // One bound row a chunk, so each chunk writes one price to catalog.
      for (const n of [1, 2, 3]) {
        await seed({
          externalId: `priced-${n}`,
          name: `Producto con precio ${n}`,
          status: SourceEntryStatus.ACTIVE,
          // A product of its own, so no chunk weighs it against another.
          itemId: `02690269-0000-4000-8000-44444444441${n}`,
          matchedBy: ItemSourceMatch.MANUAL,
          confidence: 1,
          decidedAt: new Date('2026-11-01T00:00:00.000Z'),
        });
      }
      const failure = new Error('catalog did not answer');
      const walk = sink();

      for (const n of [1, 2]) {
        report(walk, [
          product(`priced-${n}`, { name: `Producto con precio ${n}` }),
          ...fillers(`chunk${n}`, CHUNK - 1),
        ]);
        await settled(walk);
      }
      expect(pricesCalls).toBe(2);
      pricesFail = failure;
      report(walk, [
        product('priced-3', { name: 'Producto con precio 3' }),
        ...fillers('chunk3', CHUNK - 1),
      ]);

      await expect(walk.drain()).rejects.toBe(failure);
      // The first two chunks, exactly: their products, the price each read
      // per product onto its source row, and the one price each sent to
      // catalog. The third chunk wrote its rows and its source prices before
      // catalog refused, and the result does not count them (the limit the
      // run's sentence states).
      expect(walk.writtenSoFar).toMatchObject({
        products: 2 * CHUNK,
        pricesRecorded: 2 * CHUNK,
        pricesPublished: 2,
        availabilityWritten: 0,
        packCountsFilled: 0,
        approxWeightsWritten: 0,
      });
      expect(sent).toHaveLength(2);
      expect(told).toEqual([]);
    }, 120_000);

    it('does not bind by EAN a waiting row a person rejected after the open', async () => {
      await seed({
        externalId: 'barcode',
        name: 'Producto con barras',
        ean: EAN_BARCODE,
      });
      const walk = sink();

      report(walk, fillers('one', CHUNK));
      await settled(walk);
      await reject('barcode');

      report(walk, [
        product('barcode', { name: 'Producto con barras', ean: EAN_BARCODE }),
      ]);
      await walk.drain();

      expect(await row('barcode')).toMatchObject({
        status: SourceEntryStatus.REJECTED,
        matchedBy: ItemSourceMatch.MANUAL,
        itemId: null,
      });
      expect(pricedFor(ITEM_BARCODE)).toEqual([]);
    }, 120_000);

    it('changes no row when the reject lands after the decisions were read, and the outcome follows the row', async () => {
      await seed({
        externalId: 'barcode',
        name: 'Producto con barras',
        ean: EAN_BARCODE,
      });
      const walk = sink();
      report(walk, fillers('one', CHUNK));
      await settled(walk);

      // A hook between the read of the decisions of the chunk and the
      // walk's own write: the person rejects the row right there.
      const read = entries.find.bind(entries);
      let hooked = false;
      jest
        .spyOn(entries, 'find')
        .mockImplementation(async (options?: unknown) => {
          const answer = await read(options as never);
          const where = (options as { where?: Record<string, unknown> })?.where;
          if (!hooked && where && 'externalId' in where) {
            hooked = true;
            await reject('barcode');
          }
          return answer;
        });

      report(walk, [
        product('barcode', { name: 'Producto con barras', ean: EAN_BARCODE }),
      ]);
      await walk.drain();

      expect(hooked).toBe(true);
      expect(await row('barcode')).toMatchObject({
        status: SourceEntryStatus.REJECTED,
        matchedBy: ItemSourceMatch.MANUAL,
        itemId: null,
      });
      expect(pricedFor(ITEM_BARCODE)).toEqual([]);
    }, 120_000);

    it('still binds a waiting row by its EAN when nobody decided it, and still sends a shared EAN back to the queue', async () => {
      // The two guards of the walk's own decisions, holding on real Postgres:
      // a bind that changes one row, and an unbind keyed on the product.
      await seed({
        externalId: 'barcode',
        name: 'Producto con barras',
        ean: EAN_BARCODE,
      });
      await seed({
        externalId: 'shared-1',
        name: 'Producto compartido uno',
        ean: EAN_SHARED,
        status: SourceEntryStatus.ACTIVE,
        itemId: ITEM_SHARED,
        matchedBy: ItemSourceMatch.EAN,
        confidence: 1,
        decidedAt: new Date('2026-11-01T00:00:00.000Z'),
      });
      const walk = sink();

      report(walk, [
        product('barcode', { name: 'Producto con barras', ean: EAN_BARCODE }),
        product('shared-2', {
          name: 'Producto compartido dos',
          ean: EAN_SHARED,
        }),
      ]);
      await walk.drain();

      expect(await row('barcode')).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        matchedBy: ItemSourceMatch.EAN,
        itemId: ITEM_BARCODE,
      });
      expect(await row('shared-1')).toMatchObject({
        status: SourceEntryStatus.CANDIDATE,
        matchedBy: ItemSourceMatch.SHARED_EAN,
        itemId: ITEM_SHARED,
        decidedAt: null,
      });
      expect(pricedFor(ITEM_BARCODE)).toHaveLength(1);
    }, 120_000);

    it('ends the run and not the process when a chunk fails: told once, nothing after it, and the drain rejects with the failure', async () => {
      await seed({
        externalId: 'priced',
        name: 'Producto con precio',
        status: SourceEntryStatus.ACTIVE,
        itemId: ITEM_PRICED,
        matchedBy: ItemSourceMatch.MANUAL,
        confidence: 1,
        decidedAt: new Date('2026-11-01T00:00:00.000Z'),
      });
      const failure = new Error('catalog did not answer');
      pricesFail = failure;
      const unhandled: unknown[] = [];
      const listen = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', listen);
      try {
        const walk = sink();
        report(walk, [
          product('priced', { name: 'Producto con precio' }),
          ...fillers('one', CHUNK - 1),
        ]);
        // The walk goes on with network I/O while the chunk is written.
        const until = Date.now() + 60_000;
        while (pricesCalls === 0 && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await new Promise((resolve) => setTimeout(resolve, 100));

        report(walk, fillers('late', CHUNK));
        await new Promise((resolve) => setTimeout(resolve, 100));

        await expect(walk.drain()).rejects.toBe(failure);
        expect(onWriteFailed).toHaveBeenCalledTimes(1);
        expect(onWriteFailed).toHaveBeenCalledWith(failure);
        expect(unhandled).toEqual([]);
        // The rows of the failed chunk were written before its prices, and
        // stay. The second chunk wrote no row.
        const [{ count: late }] = await dataSource.query(
          `SELECT count(*)::int AS count FROM "source_catalog_entries"
            WHERE "supermarketId" = $1 AND "externalId" LIKE 'late-%'`,
          [CHAIN]
        );
        expect(late).toBe(0);
        const [{ count: first }] = await dataSource.query(
          `SELECT count(*)::int AS count FROM "source_catalog_entries"
            WHERE "supermarketId" = $1 AND "externalId" LIKE 'one-%'`,
          [CHAIN]
        );
        expect(first).toBe(CHUNK - 1);
      } finally {
        process.off('unhandledRejection', listen);
      }
    }, 120_000);
  }
);
