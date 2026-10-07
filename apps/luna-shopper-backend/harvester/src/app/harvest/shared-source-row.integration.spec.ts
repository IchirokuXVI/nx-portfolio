import {
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type ItemPriceBatchEntry,
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
import { entryKey } from './matching';
import type { RunContext } from './run-context';
import { bindFields, SourceEntryPriceWriter } from './source-entry-write';
import {
  SourceIngest,
  type SourceIngestCounters,
  type SourceObservation,
} from './source-ingest';

/**
 * One row that a website and a leaflet of one chain both print, against real
 * Postgres (plan 0190).
 *
 * A source with no product id keys its row on the printed name and format
 * (`entryKey`), so a Deza listing and a Deza leaflet that print one product
 * the same way land on one row. That is intended (plans 0085 and 0086). What
 * this proves is what the row and its prices look like after both have
 * written, in both orders:
 *
 * - The text and the kind of the row are the website walk's, whoever came
 *   last.
 * - Each price row says the kind of the run that stated it, and a website
 *   price and a leaflet price for one scope are two rows.
 * - An accept writes each price under its own kind.
 *
 * A mocked repository cannot prove the second point: it is a unique key and
 * an `ON CONFLICT` target, and only Postgres says whether the two agree.
 *
 * Catalog is another service behind the broker, so it is a recorder here.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=shared-source-row.integration.spec.ts
 */
describeIntegration(
  'a row a website and a leaflet both print (real Postgres)',
  () => {
    /** A chain nothing else in this database uses, so cleanup is exact. */
    const CHAIN = '01900190-0000-4000-8000-111111111111';
    const SCOPE = '01900190-0000-4000-8000-222222222222';
    const WEB_RUN = '01900190-0000-4000-8000-333333333301';
    const LEAFLET_RUN = '01900190-0000-4000-8000-333333333302';
    const SECOND_WEB_RUN = '01900190-0000-4000-8000-333333333303';
    const SECOND_LEAFLET_RUN = '01900190-0000-4000-8000-333333333304';
    const ITEM = '01900190-0000-4000-8000-444444444444';

    const WEB = PriceSourceKind.OFFICIAL_WEB;
    const LEAFLET = PriceSourceKind.OFFICIAL_LEAFLET;

    let dataSource: DataSource;
    let entries: Repository<SourceCatalogEntry>;
    let prices: Repository<SourceEntryPrice>;

    /** What catalog was sent, per call. */
    let sent: {
      priceScopeId: string;
      itemId: string;
      price: number | null | undefined;
      sourceRunId: string | null;
      sourceKind: PriceSourceKind;
    }[];

    const catalog = {
      searchItems: async () => ({ items: [], nextCursor: null }),
      addPrices: async (
        priceScopeId: string,
        batch: ItemPriceBatchEntry[],
        sourceRunId: string | null,
        sourceKind: PriceSourceKind
      ) => {
        for (const each of batch) {
          sent.push({
            priceScopeId,
            itemId: each.itemId,
            price: each.price,
            sourceRunId,
            sourceKind,
          });
        }
        return { inserted: batch.length, confirmed: 0 };
      },
    } as unknown as CatalogClient;

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
      await clean();
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

    /** The product, as the website lists it. The website of Deza prints no price. */
    function listing(over: Partial<SourceObservation> = {}): SourceObservation {
      return {
        externalId: entryKey('Leche COVAP entera', '1 L'),
        name: 'Leche COVAP entera',
        brand: 'COVAP',
        ean: null,
        unitSize: 1,
        sizeUnit: UnitOfMeasure.LITER,
        sizeFormat: '1 L',
        packCount: 6,
        categoryPath: ['Lácteos', 'Leche'],
        url: 'https://example.test/leche-covap-entera',
        observedAt: new Date('2026-10-03T01:42:00.000Z'),
        extra: { section: 'lacteos' },
        prices: [],
        ...over,
      };
    }

    /**
     * The same product as a model read it from a leaflet: another case, a
     * brand in another case, no size it could read, no link, and a price.
     * `entryKey` normalizes the name, so the key is the listing's.
     */
    function tile(amount = 1.15): SourceObservation {
      return {
        externalId: entryKey('Leche COVAP Entera', '1 L'),
        name: 'Leche COVAP Entera',
        brand: 'Covap',
        ean: null,
        unitSize: null,
        sizeUnit: null,
        sizeFormat: '1 L',
        categoryPath: [],
        url: null,
        observedAt: new Date('2026-10-03T16:12:00.000Z'),
        extra: { page: 4 },
        prices: [
          {
            scopeKey: null,
            price: amount,
            currency: 'EUR',
            unitPrice: null,
            unitPriceLabel: null,
            validFrom: new Date('2026-10-02T22:00:00.000Z'),
            validUntil: new Date('2099-10-08T22:00:00.000Z'),
          },
        ],
      };
    }

    async function run(
      runId: string,
      sourceKind: PriceSourceKind,
      observation: SourceObservation
    ): Promise<SourceIngestCounters> {
      const context = {
        runId,
        report: async () => undefined,
        warn: () => undefined,
      } as unknown as RunContext;
      const result = await new SourceIngest(entries, prices, catalog).ingest(
        context,
        {
          supermarketId: CHAIN,
          defaultPriceScopeId: SCOPE,
          sourceKind,
          observations: [observation],
        }
      );
      return result.counters;
    }

    const rows = () =>
      entries.find({
        where: { supermarketId: CHAIN },
        relations: { prices: true },
      });

    /** The source group of a row, as the queue shows it. */
    const textOf = (row: SourceCatalogEntry) => ({
      externalId: row.externalId,
      sourceKind: row.sourceKind,
      name: row.name,
      brand: row.brand,
      brandKey: row.brandKey,
      unitSize: row.unitSize === null ? null : Number(row.unitSize),
      sizeUnit: row.sizeUnit,
      sizeFormat: row.sizeFormat,
      packCount: row.packCount,
      categoryPath: row.categoryPath,
      url: row.url,
      extra: row.extra,
    });

    const pricesOf = (row: SourceCatalogEntry) =>
      (row.prices ?? [])
        .map((each) => ({
          sourceKind: each.sourceKind,
          price: Number(each.price),
          runId: each.runId,
        }))
        .sort((a, b) =>
          String(a.sourceKind).localeCompare(String(b.sourceKind))
        );

    it('the key of the listing and of the tile is one key', () => {
      // The premise of the plan. If this ever fails the two sources stopped
      // sharing a row, and every other case here proves nothing.
      expect(tile().externalId).toBe(listing().externalId);
    });

    it('a leaflet import after a website run leaves the row as the website wrote it, and adds one leaflet price', async () => {
      await run(WEB_RUN, WEB, listing());
      const [walked] = await rows();
      const before = textOf(walked);

      const counters = await run(LEAFLET_RUN, LEAFLET, tile());

      const after = await rows();
      expect(after).toHaveLength(1);
      // The kind, the name, the brand, the size, the link: all the website's.
      expect(textOf(after[0])).toEqual(before);
      expect(after[0]).toMatchObject({
        sourceKind: WEB,
        name: 'Leche COVAP entera',
        brand: 'COVAP',
        sizeFormat: '1 L',
      });
      expect(Number(after[0].unitSize)).toBe(1);
      // The seen fields moved, and the first run is still the website's.
      expect(after[0]).toMatchObject({
        timesSeen: 2,
        firstRunId: WEB_RUN,
        lastRunId: LEAFLET_RUN,
      });
      // One price row, of the leaflet's kind, with the leaflet's own bag.
      expect(pricesOf(after[0])).toEqual([
        { sourceKind: LEAFLET, price: 1.15, runId: LEAFLET_RUN },
      ]);
      expect(after[0].prices[0].details).toEqual({ page: 4 });
      // And the import counts the row as one it left alone.
      expect(counters).toMatchObject({
        created: 0,
        updated: 0,
        unchanged: 1,
        pricesRecorded: 1,
      });
    }, 60_000);

    it('a website run takes over a row that a leaflet created, once, and a second import changes nothing in it', async () => {
      const created = await run(LEAFLET_RUN, LEAFLET, tile());
      expect(created).toMatchObject({ created: 1 });
      expect((await rows())[0]).toMatchObject({
        sourceKind: LEAFLET,
        name: 'Leche COVAP Entera',
        brand: 'Covap',
      });

      // The takeover.
      const taken = await run(WEB_RUN, WEB, listing());
      expect(taken).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
      const [owned] = await rows();
      expect(owned).toMatchObject({
        sourceKind: WEB,
        name: 'Leche COVAP entera',
        brand: 'COVAP',
        url: 'https://example.test/leche-covap-entera',
        firstRunId: LEAFLET_RUN,
      });
      // The price the leaflet stated is still a leaflet price.
      expect(pricesOf(owned)).toEqual([
        { sourceKind: LEAFLET, price: 1.15, runId: LEAFLET_RUN },
      ]);
      const text = textOf(owned);

      // A second leaflet import: prices and seen fields only.
      const second = await run(SECOND_LEAFLET_RUN, LEAFLET, tile(1.09));
      expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
      const [after] = await rows();
      expect(textOf(after)).toEqual(text);
      expect(pricesOf(after)).toEqual([
        { sourceKind: LEAFLET, price: 1.09, runId: SECOND_LEAFLET_RUN },
      ]);

      // And the next website run finds its own text: it takes over once.
      const again = await run(SECOND_WEB_RUN, WEB, listing());
      expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    }, 60_000);

    it('keeps a website price and a leaflet price for one scope, through both runs and in both orders', async () => {
      const priced = (amount: number) =>
        listing({
          prices: [
            {
              scopeKey: null,
              price: amount,
              currency: 'EUR',
              unitPrice: amount,
              unitPriceLabel: 'L',
              validFrom: null,
              validUntil: null,
            },
          ],
        });

      await run(WEB_RUN, WEB, priced(1.25));
      await run(LEAFLET_RUN, LEAFLET, tile());

      expect(pricesOf((await rows())[0])).toEqual([
        { sourceKind: LEAFLET, price: 1.15, runId: LEAFLET_RUN },
        { sourceKind: WEB, price: 1.25, runId: WEB_RUN },
      ]);

      // Each run replaces the price of its own kind and leaves the other's.
      await run(SECOND_WEB_RUN, WEB, priced(1.29));
      expect(pricesOf((await rows())[0])).toEqual([
        { sourceKind: LEAFLET, price: 1.15, runId: LEAFLET_RUN },
        { sourceKind: WEB, price: 1.29, runId: SECOND_WEB_RUN },
      ]);
      await run(SECOND_LEAFLET_RUN, LEAFLET, tile(0.99));
      expect(pricesOf((await rows())[0])).toEqual([
        { sourceKind: LEAFLET, price: 0.99, runId: SECOND_LEAFLET_RUN },
        { sourceKind: WEB, price: 1.29, runId: SECOND_WEB_RUN },
      ]);
    }, 60_000);

    it('an accept of the website row writes its leaflet price as a leaflet price, with the run of the leaflet', async () => {
      await run(WEB_RUN, WEB, listing());
      await run(LEAFLET_RUN, LEAFLET, tile());
      const [row] = await rows();
      expect(row.status).toBe(SourceEntryStatus.UNRESOLVED);
      expect(sent).toEqual([]);

      await entries.save(bindFields(row, ITEM));
      const written = await new SourceEntryPriceWriter(catalog, entries).write(
        row
      );

      expect(written).toBe(1);
      expect(sent).toEqual([
        {
          priceScopeId: SCOPE,
          itemId: ITEM,
          price: 1.15,
          sourceRunId: LEAFLET_RUN,
          sourceKind: LEAFLET,
        },
      ]);
    }, 60_000);

    it('a leaflet import of a bound website row sends its price to catalog as a leaflet price', async () => {
      await run(WEB_RUN, WEB, listing());
      const [row] = await rows();
      await entries.save(bindFields(row, ITEM));

      await run(LEAFLET_RUN, LEAFLET, tile());

      expect(sent).toEqual([
        {
          priceScopeId: SCOPE,
          itemId: ITEM,
          price: 1.15,
          sourceRunId: LEAFLET_RUN,
          sourceKind: LEAFLET,
        },
      ]);
      // The decision is where it was.
      expect((await rows())[0]).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        itemId: ITEM,
        sourceKind: WEB,
      });
    }, 60_000);
  }
);
