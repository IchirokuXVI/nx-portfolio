import type { ConfigService } from '@nestjs/config';
import {
  PriceSourceKind,
  SourceEntryStatus,
  SourceLocationStatus,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
  SourceLocation,
  type SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { DezaCatalogRunner } from './deza-catalog.runner';
import {
  startFakeListing,
  type FakeListing,
  type FakeProduct,
} from './deza-listing.fake';
import type { PlatformAdminService } from './platform-admin.service';
import type { RunContext } from './run-context';
import { RunReportSink, type RunReportResult } from './run-report.sink';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { SourceEntryPriceWriter } from './source-entry-write';
import { SourceEntryService } from './source-entry.service';
import { SourceIngest } from './source-ingest';
import { SourceLocationService } from './source-location.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * A chain that lists a product sells it, against real Postgres (plan 0182).
 *
 * **It runs the DEZA runner through the real write half**: the runner crawls a
 * listing that answers on localhost, the real `RunReportSink` drains it into
 * the real `SourceIngest`, the real `SourceLocationService` and the real
 * `SourceEntryAvailabilityWriter`, and the rows land in the harvester's own
 * database. Then a row is accepted through the real `SourceEntryService` and a
 * shop is mapped through the real `SourceLocationService`.
 *
 * It needs a database because the thing under test is a table and the query
 * over it: which stored claims are ready is a join of three tables, the upsert
 * is an `ON CONFLICT` on a unique constraint, and a repository double answers
 * whatever it is handed and can prove neither.
 *
 * **Catalog is a recording double**, as in every harvester integration spec. It
 * is another service behind the broker, and what it does with an availability
 * write (the ladder, the scope flag it derives, the row with no price) is
 * proved in catalog's own specs. What is asserted here is what catalog is
 * told, and when.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/** A chain nothing else in this database uses, so cleanup is exact. */
const CHAIN = '01820000-0000-4000-8000-000000000001';
const DEFAULT_SCOPE = '01820000-0000-4000-8000-00000000005c';

const LOC_T1 = '01820000-0000-4000-8000-0000000000a1';
const LOC_C1 = '01820000-0000-4000-8000-0000000000a2';

const ITEM_BREAD = '01820000-0000-4000-8000-0000000000b1';

const RUN_1 = '01820000-0000-4000-8000-0000000000c1';
const RUN_2 = '01820000-0000-4000-8000-0000000000c2';

const ADMIN = '01820000-0000-4000-8000-0000000000d1';

const SECTIONS = [
  {
    code: 'W050000000',
    name: 'PAN',
    children: [{ code: 'W051', name: 'Bolleria' }],
  },
];

/**
 * Three products over three shops. The popup names the shops that carry a
 * product, so every shop it does not name is a negative claim: nine claims.
 */
const FIRST_LISTING: FakeProduct[] = [
  {
    description: 'Pan de molde ALTEZA 400 g',
    section: 'W051',
    shops: ['T1', 'C1'],
  },
  { description: 'Croissants ALTEZA 360 g', section: 'W051', shops: ['T1'] },
  { description: 'Magdalenas ALTEZA 500 g', section: 'W051', shops: ['Z1'] },
];

/** The same three, and the bread has moved: out of T1, into Z1. */
const SECOND_LISTING: FakeProduct[] = [
  {
    description: 'Pan de molde ALTEZA 400 g',
    section: 'W051',
    shops: ['C1', 'Z1'],
  },
  { description: 'Croissants ALTEZA 360 g', section: 'W051', shops: ['T1'] },
  { description: 'Magdalenas ALTEZA 500 g', section: 'W051', shops: ['Z1'] },
];

interface LocationWrite {
  supermarketLocationId: string;
  entries: { itemId: string; available: boolean }[];
  runId: string | null;
  sourceKind: PriceSourceKind;
}

interface ScopeWrite {
  priceScopeId: string;
  entries: { itemId: string; available: boolean }[];
}

describeIntegration(
  'availability a run stored, sent when it is ready (real Postgres)',
  () => {
    let dataSource: DataSource;
    let entries: Repository<SourceCatalogEntry>;
    let shops: Repository<SourceLocation>;
    let claims: Repository<SourceEntryAvailability>;

    let ingest: SourceIngest;
    let availability: SourceEntryAvailabilityWriter;
    let locations: SourceLocationService;
    let decisions: SourceEntryService;
    let catalog: CatalogClient;

    /** Every per shop write catalog was sent, in order. */
    let locationWrites: LocationWrite[];
    /** Every per scope write catalog was sent, in order. */
    let scopeWrites: ScopeWrite[];
    /** The chain's default scope, which a test can take away. */
    let defaultScope: string | null;

    let listing: FakeListing | undefined;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('HARVESTER_DB_URL'),
        entities: HARVESTER_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();
      entries = dataSource.getRepository(SourceCatalogEntry);
      shops = dataSource.getRepository(SourceLocation);
      claims = dataSource.getRepository(SourceEntryAvailability);
      const prices = dataSource.getRepository(SourceEntryPrice);

      const location = (id: string, label: string) =>
        ({
          id,
          supermarketId: CHAIN,
          label: { es: label },
          address: null,
          postalCode: null,
        }) as unknown as SupermarketLocationView;

      catalog = {
        // An empty catalog: no row of the run resolves to a product, which is
        // what the first run of a chain looks like.
        searchItems: async () => ({ items: [], nextCursor: null }),
        findItemByEan: async () => ({ item: null }),
        fillPackCounts: async () => ({ written: 0 }),
        addPrices: async () => ({ inserted: 0, confirmed: 0 }),
        // The chain has two shops of ours. One carries the name DEZA prints
        // for T1, so the default name match maps it on first sight; the other
        // does not, so C1 waits in the queue for a person.
        listSupermarketLocations: async () => ({
          items: [
            location(LOC_T1, 'Jesús Rescatado'),
            location(LOC_C1, 'Polígono de las Quemadas'),
          ],
          nextCursor: null,
        }),
        getSupermarketLocation: async (id: string) => location(id, 'a shop'),
        getSupermarket: async () => ({
          id: CHAIN,
          defaultPriceScopeId: defaultScope,
        }),
        setAvailability: async (
          priceScopeId: string,
          sent: { itemId: string; available: boolean }[]
        ) => {
          scopeWrites.push({ priceScopeId, entries: sent });
          return { updated: sent.length };
        },
        setLocationAvailability: async (
          supermarketLocationId: string,
          sent: { itemId: string; available: boolean }[],
          runId: string | null,
          sourceKind: PriceSourceKind
        ) => {
          locationWrites.push({
            supermarketLocationId,
            entries: sent,
            runId,
            sourceKind,
          });
          return { written: sent.length, skipped: 0, conflicts: [] };
        },
      } as unknown as CatalogClient;

      const admin = {
        requireAdmin: async () => ADMIN,
      } as unknown as PlatformAdminService;

      ingest = new SourceIngest(entries, prices, catalog);
      availability = new SourceEntryAvailabilityWriter(claims, catalog);
      locations = new SourceLocationService(
        shops,
        catalog,
        admin,
        availability
      );
      decisions = new SourceEntryService(
        entries,
        prices,
        dataSource.getRepository(HarvestRun),
        catalog,
        // An accept reads no source row: only `createItem` asks for the adapter.
        {} as unknown as SupermarketSourceService,
        admin,
        new SourceEntryPriceWriter(catalog, entries),
        {} as unknown as ConfigService,
        availability
      );
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await clean();
        await dataSource.destroy();
      }
    });

    beforeEach(async () => {
      locationWrites = [];
      scopeWrites = [];
      defaultScope = DEFAULT_SCOPE;
      await clean();
    });

    afterEach(async () => {
      await listing?.close();
      listing = undefined;
    });

    async function clean(): Promise<void> {
      // The claims go with either side: both foreign keys cascade.
      await dataSource.query(
        `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
        [CHAIN]
      );
      await dataSource.query(
        `DELETE FROM "source_locations" WHERE "supermarketId" = $1`,
        [CHAIN]
      );
    }

    /** One whole DEZA run over a listing: the runner reports, the sink writes. */
    async function run(
      runId: string,
      products: FakeProduct[]
    ): Promise<RunReportResult> {
      await listing?.close();
      listing = await startFakeListing(SECTIONS, products);

      const context = {
        runId,
        signal: new AbortController().signal,
        acquire: async () => undefined,
        setStage: async () => undefined,
        setTotalPlanned: async () => undefined,
        report: async () => undefined,
        heartbeat: async () => undefined,
        flush: async () => undefined,
        setReport: async () => undefined,
        warn: () => undefined,
      } as unknown as RunContext;

      const sink = new RunReportSink(
        context,
        {
          supermarketId: CHAIN,
          defaultPriceScopeId: DEFAULT_SCOPE,
          // What `RunExecutor` hands a `deza-web` run.
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          postalCodeDeriveMaxMetres: 5000,
          autoImportPlaces: false,
        },
        {
          ingest,
          // DEZA declares no scope and reports no place.
          scopes: null,
          places: {} as never,
          shops: locations,
          catalog,
          entries,
          availability,
        }
      );

      const runner = new DezaCatalogRunner({
        getOrThrow: () => ({ userAgent: 'test' }),
      } as unknown as ConfigService);
      await runner.run(context, sink, { supermarketId: CHAIN }, {
        adapterKey: 'deza-web',
        workers: 1,
        config: { baseUrl: listing.url },
      } as unknown as SupermarketSource);
      return sink.drain();
    }

    /** The stored claims, as `product@shop` -> what the table holds. */
    async function stored(): Promise<
      Record<string, { available: boolean; runId: string | null }>
    > {
      const rows: {
        name: string;
        shop: string;
        available: boolean;
        runId: string | null;
      }[] = await dataSource.query(
        `SELECT e."name" AS "name", l."externalId" AS "shop",
                a."available" AS "available", a."runId"::text AS "runId"
           FROM "source_entry_availability" a
           JOIN "source_catalog_entries" e ON e."id" = a."entryId"
           JOIN "source_locations" l ON l."id" = a."sourceLocationId"
          WHERE e."supermarketId" = $1`,
        [CHAIN]
      );
      return Object.fromEntries(
        rows.map((row) => [
          `${productOf(row.name)}@${row.shop}`,
          { available: row.available, runId: row.runId },
        ])
      );
    }

    /** How many claims the chain holds: rows, so a duplicate would show. */
    async function claimCount(): Promise<number> {
      const [row]: { count: number }[] = await dataSource.query(
        `SELECT count(*)::int AS "count"
           FROM "source_entry_availability" a
           JOIN "source_catalog_entries" e ON e."id" = a."entryId"
          WHERE e."supermarketId" = $1`,
        [CHAIN]
      );
      return row.count;
    }

    /** The row of one product, by the first word the listing printed. */
    async function rowOf(product: string): Promise<SourceCatalogEntry> {
      const rows = await entries.find({ where: { supermarketId: CHAIN } });
      const row = rows.find((each) => productOf(each.name) === product);
      if (!row) {
        throw new Error(`No row for ${product}`);
      }
      return row;
    }

    async function shopOf(code: string): Promise<SourceLocation> {
      return shops.findOneOrFail({
        where: { supermarketId: CHAIN, externalId: code },
      });
    }

    function accept(row: SourceCatalogEntry, itemId: string) {
      return decisions.accept({ userId: ADMIN, entryId: row.id, itemId });
    }

    it('stores one claim per shop and product with no row bound, and writes nothing to catalog', async () => {
      const written = await run(RUN_1, FIRST_LISTING);

      // Nothing is bound: the catalog is empty and DEZA publishes no EAN.
      const rows = await entries.find({ where: { supermarketId: CHAIN } });
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.itemId === null)).toBe(true);
      expect(rows.every((row) => row.status !== SourceEntryStatus.ACTIVE)).toBe(
        true
      );

      // Three products over three shops, the negatives included.
      const claim = (available: boolean) => ({ available, runId: RUN_1 });
      expect(await stored()).toEqual({
        'pan@T1': claim(true),
        'pan@C1': claim(true),
        'pan@Z1': claim(false),
        'croissants@T1': claim(true),
        'croissants@C1': claim(false),
        'croissants@Z1': claim(false),
        'magdalenas@T1': claim(false),
        'magdalenas@C1': claim(false),
        'magdalenas@Z1': claim(true),
      });

      // T1 was mapped by the default name match and its claims still wait,
      // because no row names a product yet.
      expect((await shopOf('T1')).supermarketLocationId).toBe(LOC_T1);
      expect(locationWrites).toEqual([]);
      expect(scopeWrites).toEqual([]);

      // The three counts of the run report.
      expect(written).toMatchObject({
        claimsStored: 9,
        claimsWritten: 0,
        claimsWaiting: 9,
        claimsWaitingForBinding: 9,
        claimsWaitingForShop: 0,
        shopsWritten: 0,
        availabilityWritten: 0,
      });
    }, 120_000);

    it('writes the claims for mapped shops, and an offer with no price, when a row is bound', async () => {
      await run(RUN_1, FIRST_LISTING);
      expect(locationWrites).toEqual([]);

      const result = await accept(await rowOf('pan'), ITEM_BREAD);

      // DEZA prints no price, so there is none to write.
      expect(result.pricesWritten).toBe(0);
      // A chain that lists a product sells it: a `supermarket_items` row with
      // no price in the chain's default scope, through catalog's own
      // availability write.
      expect(scopeWrites).toEqual([
        {
          priceScopeId: DEFAULT_SCOPE,
          entries: [{ itemId: ITEM_BREAD, available: true }],
        },
      ]);
      // T1 is the one mapped shop. C1 and Z1 are not, so nothing is sent for
      // them, and nothing is sent for the two rows nobody bound.
      expect(locationWrites).toEqual([
        {
          supermarketLocationId: LOC_T1,
          entries: [{ itemId: ITEM_BREAD, available: true }],
          // The run that stated the claim, not the moment it was accepted.
          runId: RUN_1,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
        },
      ]);
    }, 120_000);

    it('writes no offer for a chain that has no default scope', async () => {
      await run(RUN_1, FIRST_LISTING);
      defaultScope = null;

      await accept(await rowOf('pan'), ITEM_BREAD);

      expect(scopeWrites).toEqual([]);
      // The shop claims do not depend on the chain having one.
      expect(locationWrites).toHaveLength(1);
    }, 120_000);

    it('writes the claims of rows already bound when a shop is mapped afterwards', async () => {
      await run(RUN_1, FIRST_LISTING);
      await accept(await rowOf('pan'), ITEM_BREAD);
      locationWrites = [];

      const c1 = await shopOf('C1');
      expect(c1.status).toBe(SourceLocationStatus.UNMAPPED);
      const view = await locations.map({
        userId: ADMIN,
        sourceLocationId: c1.id,
        supermarketLocationId: LOC_C1,
      });

      expect(view.status).toBe(SourceLocationStatus.ACTIVE);
      // The bread is the only bound row. The croissants and the magdalenas
      // hold a claim for C1 too, and they keep waiting for a binding.
      expect(locationWrites).toEqual([
        {
          supermarketLocationId: LOC_C1,
          entries: [{ itemId: ITEM_BREAD, available: true }],
          runId: RUN_1,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
        },
      ]);
    }, 120_000);

    it('flips available on a second run with a changed shop list, and adds no duplicate', async () => {
      await run(RUN_1, FIRST_LISTING);
      await accept(await rowOf('pan'), ITEM_BREAD);
      const before = await claimCount();
      locationWrites = [];

      const written = await run(RUN_2, SECOND_LISTING);

      // Nine pairs before and nine after: a claim is replaced, never added.
      expect(before).toBe(9);
      expect(await claimCount()).toBe(9);
      const after = await stored();
      // The bread left T1 and arrived at Z1.
      expect(after['pan@T1']).toEqual({ available: false, runId: RUN_2 });
      expect(after['pan@Z1']).toEqual({ available: true, runId: RUN_2 });
      // What did not change says so again, as this run's claim.
      expect(after['pan@C1']).toEqual({ available: true, runId: RUN_2 });
      expect(after['croissants@T1']).toEqual({ available: true, runId: RUN_2 });

      // The row is bound by now, so the end of the run sends its claim for
      // the mapped shop, read from the table: the negative is written as
      // false and nothing is deleted.
      expect(locationWrites).toEqual([
        {
          supermarketLocationId: LOC_T1,
          entries: [{ itemId: ITEM_BREAD, available: false }],
          runId: RUN_2,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
        },
      ]);

      // Stored is written plus waiting: the bread at T1 is written, the bread
      // at C1 and Z1 waits for a shop, and the other six wait for a binding.
      expect(written).toMatchObject({
        claimsStored: 9,
        claimsWritten: 1,
        claimsWaiting: 8,
        claimsWaitingForBinding: 6,
        claimsWaitingForShop: 2,
        shopsWritten: 1,
        availabilityWritten: 1,
      });
    }, 120_000);

    it('says a product two rows are bound to is stocked where either row is', async () => {
      await run(RUN_1, FIRST_LISTING);
      const c1 = await shopOf('C1');
      await locations.map({
        userId: ADMIN,
        sourceLocationId: c1.id,
        supermarketLocationId: LOC_C1,
      });
      // The bread is at T1 and C1. The croissants are at T1 only.
      await accept(await rowOf('pan'), ITEM_BREAD);
      locationWrites = [];

      // The second row of the same product. Its own claim for C1 is false,
      // and it must not overwrite what the first row said.
      await accept(await rowOf('croissants'), ITEM_BREAD);

      const byShop = Object.fromEntries(
        locationWrites.map((write) => [
          write.supermarketLocationId,
          write.entries,
        ])
      );
      expect(byShop).toEqual({
        [LOC_T1]: [{ itemId: ITEM_BREAD, available: true }],
        [LOC_C1]: [{ itemId: ITEM_BREAD, available: true }],
      });
    }, 120_000);

    it('deletes a claim with its row, and with its shop', async () => {
      await run(RUN_1, FIRST_LISTING);

      await entries.delete({ id: (await rowOf('pan')).id });
      expect(await claimCount()).toBe(6);

      await shops.delete({ id: (await shopOf('Z1')).id });
      expect(await claimCount()).toBe(4);
    }, 120_000);
  }
);

/** `Pan de molde …` -> `pan`: the first word of what the listing printed. */
function productOf(name: string): string {
  return name.trim().split(/\s+/)[0].toLowerCase();
}
