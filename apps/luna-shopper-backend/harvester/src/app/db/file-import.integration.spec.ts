import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type HarvestDocument,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from '../harvest/catalog-client.service';
import { FileImportRunner } from '../harvest/file-import.runner';
import { buildHarvestDocument } from '../harvest/harvest-export';
import { entryKey } from '../harvest/matching';
import type { PlatformAdminService } from '../harvest/platform-admin.service';
import { PriceScopeResolver } from '../harvest/price-scope-resolver';
import type { RunContext } from '../harvest/run-context';
import { SourceEntryService } from '../harvest/source-entry.service';
import { SourceIngest } from '../harvest/source-ingest';
import type { SupermarketSourceService } from '../harvest/supermarket-source.service';

/**
 * What plan 0086 promises in the schema rather than in code, against a real
 * Postgres.
 *
 * These are the things that either work or silently do not, and no mocked
 * repository can tell you which: a partial unique index with three conditions in
 * its predicate, one row per key per chain, one price per scope per row with a
 * cascade behind it, and a revert whose criteria are two columns and two enum
 * labels. The unit suite pins the ladder and the runners; this pins the
 * database.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('the one source product schema (real Postgres)', () => {
  const CHAIN = '5efa0000-0000-4000-a000-00000000b001';
  const OTHER_CHAIN = '5efa0000-0000-4000-a000-00000000b002';
  const NORTH = '5efa0000-0000-4000-a000-00000000b0ff';
  const SOUTH = '5efa0000-0000-4000-a000-00000000b0fe';
  const RUN = '5efa0000-0000-4000-a000-00000000c001';
  const LATER_RUN = '5efa0000-0000-4000-a000-00000000c002';
  const ADMIN = '5efa0000-0000-4000-a000-00000000a001';
  const DIGEST = 'e'.repeat(64);
  const MARK = 'file-import-integration-test';

  let dataSource: DataSource;
  let runs: ReturnType<DataSource['getRepository<HarvestRun>']>;
  let entries: ReturnType<DataSource['getRepository<SourceCatalogEntry>']>;
  let prices: ReturnType<DataSource['getRepository<SourceEntryPrice>']>;
  let rows: SourceEntryService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    runs = dataSource.getRepository(HarvestRun);
    entries = dataSource.getRepository(SourceCatalogEntry);
    prices = dataSource.getRepository(SourceEntryPrice);
    // The queue read and the two revert methods touch the three repositories and
    // the gate, and nothing else: the collaborators an accept needs are
    // deliberately absent, so a call that reached one would fail loudly rather
    // than pass on a stub.
    rows = new SourceEntryService(
      entries,
      prices,
      runs,
      undefined as unknown as CatalogClient,
      undefined as unknown as SupermarketSourceService,
      {
        requireAdmin: async () => ADMIN,
      } as unknown as PlatformAdminService,
      undefined as never,
      undefined as unknown as ConfigService,
      undefined as never,
      undefined as never
    );
  });

  beforeEach(async () => {
    await clean();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  async function clean(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "correlationId" = $1`,
      [MARK]
    );
    // The price rows go with their entries, by the cascade this file asserts.
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" IN ($1, $2)`,
      [CHAIN, OTHER_CHAIN]
    );
  }

  function importRun(patch: Partial<HarvestRun> = {}): Partial<HarvestRun> {
    return {
      supermarketId: CHAIN,
      sourceId: null,
      priceScopeId: NORTH,
      mode: HarvestRunMode.FILE_IMPORT,
      status: HarvestRunStatus.COMPLETED,
      documentSha256: DIGEST,
      correlationId: MARK,
      ...patch,
    };
  }

  function row(patch: Partial<SourceCatalogEntry> = {}): SourceCatalogEntry {
    return entries.create({
      supermarketId: CHAIN,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      externalId: 'k-cerveza',
      name: 'Cerveza Alhambra Tradicional',
      sizeFormat: 'lata 33 cl',
      status: SourceEntryStatus.UNRESOLVED,
      matchedBy: null,
      confidence: 0,
      firstRunId: RUN,
      lastRunId: RUN,
      ...patch,
    });
  }

  describe('the run, and the file it holds', () => {
    it('takes a run with a chain and no source at all', async () => {
      // `SupermarketSource` is fetching configuration, and an upload fetches
      // nothing, so a chain with no adapter at all has no source row.
      const saved = await runs.save(runs.create(importRun()));

      expect(saved.sourceId).toBeNull();
      expect(saved.mode).toBe(HarvestRunMode.FILE_IMPORT);
      expect(saved.skipped).toBe(0);
      expect(saved.warnings).toEqual([]);
      expect(saved.revertedAt).toBeNull();
    });

    it('refuses a second import of one document for one chain', async () => {
      await runs.save(runs.create(importRun()));

      await expect(runs.save(runs.create(importRun()))).rejects.toThrow(
        /uq_harvest_run_leaflet_document/
      );
    });

    it('lets a failed run be retried, because it wrote nothing', async () => {
      await runs.save(
        runs.create(importRun({ status: HarvestRunStatus.FAILED }))
      );

      const retry = await runs.save(runs.create(importRun()));
      expect(retry.id).toBeDefined();
    });

    it('lets a corrected upload through once the run is reverted', async () => {
      const first = await runs.save(runs.create(importRun()));
      first.revertedAt = new Date();
      await runs.save(first);

      const again = await runs.save(runs.create(importRun()));
      expect(again.id).not.toBe(first.id);
    });

    it('scopes the lock to the chain, so two chains may hold one digest', async () => {
      await runs.save(runs.create(importRun()));

      const other = await runs.save(
        runs.create(importRun({ supermarketId: OTHER_CHAIN }))
      );
      expect(other.id).toBeDefined();
    });

    it('has no REFRESH label left in the run mode type', async () => {
      await expect(
        dataSource.query(`SELECT 'REFRESH'::harvest_run_mode`)
      ).rejects.toThrow(/invalid input value/);
      await expect(
        dataSource.query(`SELECT 'LEAFLET_IMPORT'::harvest_run_mode`)
      ).rejects.toThrow(/invalid input value/);
    });
  });

  describe('the one table', () => {
    it('holds one row per key per chain, whatever the source kind', async () => {
      const saved = await entries.save(
        row({
          matchedBy: ItemSourceMatch.NAME_SIZE,
          status: SourceEntryStatus.CANDIDATE,
          confidence: 0.6,
        })
      );

      expect(saved.status).toBe(SourceEntryStatus.CANDIDATE);
      expect(saved.matchedBy).toBe(ItemSourceMatch.NAME_SIZE);
      expect(saved.timesSeen).toBe(1);

      // The same key for this chain is the same product, even observed by a
      // different kind of source, which is what makes the two meet (D2).
      await expect(
        entries.save(
          row({
            sourceKind: PriceSourceKind.OFFICIAL_WEB,
            name: 'Cerveza Alhambra Tradicional, otra lectura',
          })
        )
      ).rejects.toThrow(/uq_source_catalog_entry/);

      // The same string for another chain is another product's row.
      const elsewhere = await entries.save(row({ supermarketId: OTHER_CHAIN }));
      expect(elsewhere.id).not.toBe(saved.id);
    });

    it('has no EXTERNAL_ID left in the match type', async () => {
      // It said an existing row was touched, and touching is not a match.
      await expect(
        dataSource.query(`SELECT 'EXTERNAL_ID'::item_source_match`)
      ).rejects.toThrow(/invalid input value/);
    });

    it('dropped the two tables it replaced', async () => {
      const [held] = await dataSource.query(
        `SELECT to_regclass('public.item_source_refs') AS refs,
                to_regclass('public.source_aliases') AS aliases`
      );
      expect(held.refs).toBeNull();
      expect(held.aliases).toBeNull();
    });
  });

  describe('a price per scope', () => {
    it('holds two regions of one chain side by side on one row', async () => {
      // A chain has several leaflets at once because each is for a region, and
      // two of them print the same product (D3). The decision is one and the
      // prices are two.
      const entry = await entries.save(row());
      await prices.save([
        prices.create({
          entryId: entry.id,
          priceScopeId: NORTH,
          price: 0.53,
          currency: 'EUR',
          runId: RUN,
        }),
        prices.create({
          entryId: entry.id,
          priceScopeId: SOUTH,
          price: 0.59,
          currency: 'EUR',
          runId: LATER_RUN,
        }),
      ]);

      const held = await prices.find({
        where: { entryId: entry.id },
        order: { price: 'ASC' },
      });
      expect(held.map((each) => Number(each.price))).toEqual([0.53, 0.59]);
    });

    it('replaces a scope its own row of one kind rather than adding a second', async () => {
      const entry = await entries.save(row());
      const first = prices.create({
        entryId: entry.id,
        priceScopeId: NORTH,
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 0.53,
        currency: 'EUR',
        runId: RUN,
      });
      await prices.save(first);

      await expect(
        prices.save(
          prices.create({
            entryId: entry.id,
            priceScopeId: NORTH,
            sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
            price: 0.59,
            currency: 'EUR',
            runId: LATER_RUN,
          })
        )
      ).rejects.toThrow(/uq_source_entry_prices_scope_kind/);

      // Which is why the ingest upserts on those three (plan 0190).
      await prices.upsert(
        [
          {
            entryId: entry.id,
            priceScopeId: NORTH,
            sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
            price: 0.59,
            currency: 'EUR',
            runId: LATER_RUN,
          },
        ],
        { conflictPaths: ['entryId', 'priceScopeId', 'sourceKind'] }
      );
      const held = await prices.find({ where: { entryId: entry.id } });
      expect(held).toHaveLength(1);
      expect(Number(held[0].price)).toBe(0.59);
    });

    it('holds a website price and a leaflet price for one scope side by side (plan 0190)', async () => {
      // A website and a leaflet of one chain print one product the same
      // way, and share the row. Each states its own price.
      const entry = await entries.save(
        row({ sourceKind: PriceSourceKind.OFFICIAL_WEB })
      );
      await prices.save([
        prices.create({
          entryId: entry.id,
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          price: 1.25,
          currency: 'EUR',
          runId: RUN,
        }),
        prices.create({
          entryId: entry.id,
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          price: 1.15,
          currency: 'EUR',
          runId: LATER_RUN,
        }),
      ]);

      const held = await prices.find({
        where: { entryId: entry.id },
        order: { price: 'ASC' },
      });
      expect(held.map((each) => [each.sourceKind, Number(each.price)])).toEqual(
        [
          [PriceSourceKind.OFFICIAL_LEAFLET, 1.15],
          [PriceSourceKind.OFFICIAL_WEB, 1.25],
        ]
      );
    });

    it('holds one price of no kind per scope at most, as before the plan', async () => {
      // Only a row from before plan 0190 has no kind. The key counts two
      // nulls as equal, so such rows cannot multiply.
      const entry = await entries.save(row());
      await prices.save(
        prices.create({
          entryId: entry.id,
          priceScopeId: NORTH,
          sourceKind: null,
          price: 0.53,
          currency: 'EUR',
          runId: null,
        })
      );

      await expect(
        prices.save(
          prices.create({
            entryId: entry.id,
            priceScopeId: NORTH,
            sourceKind: null,
            price: 0.59,
            currency: 'EUR',
            runId: null,
          })
        )
      ).rejects.toThrow(/uq_source_entry_prices_scope_kind/);
    });

    it('takes its rows with the entry, by the cascade', async () => {
      const entry = await entries.save(row());
      await prices.save(
        prices.create({
          entryId: entry.id,
          priceScopeId: NORTH,
          price: 0.53,
          currency: 'EUR',
          runId: RUN,
        })
      );

      await entries.delete({ id: entry.id });
      expect(await prices.find({ where: { entryId: entry.id } })).toEqual([]);
    });
  });

  describe('the queue read', () => {
    it('pages a joined read without mangling its own ordering', async () => {
      // `take` beside a `leftJoinAndSelect` makes TypeORM page through a
      // DISTINCT subquery and rewrite the ORDER BY into it. A quoted column in
      // that clause becomes `distinctAlias.e_"lastSeenAt"`, which is not a
      // column, and **every** request 500s. No mocked repository can see it:
      // this test exists because a real one did.
      const first = await entries.save(
        row({ externalId: 'k-one', name: 'Uno', lastSeenAt: new Date(1) })
      );
      const second = await entries.save(
        row({ externalId: 'k-two', name: 'Dos', lastSeenAt: new Date(2) })
      );
      await prices.save(
        prices.create({
          entryId: second.id,
          priceScopeId: NORTH,
          price: 0.53,
          currency: 'EUR',
          runId: RUN,
        })
      );

      const page = await rows.list({
        userId: ADMIN,
        adminToken: 'stubbed',
        supermarketId: CHAIN,
        limit: 10,
      });

      // Newest observation first, which is the order a queue reads in, and each
      // row carries its prices inline.
      expect(page.items.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(page.items[0].prices).toHaveLength(1);
      expect(page.items[1].prices).toEqual([]);
    });
  });

  describe('the revert (section 8)', () => {
    it('deletes what the run alone stands behind, and nothing a person decided', async () => {
      const undecided = await entries.save(
        row({ externalId: 'k-undecided', name: 'Nadie decidió' })
      );
      const seenAgain = await entries.save(
        row({
          externalId: 'k-seen-again',
          name: 'Un run posterior la vio',
          lastRunId: LATER_RUN,
        })
      );
      const accepted = await entries.save(
        row({
          externalId: 'k-accepted',
          name: 'Aceptada por una persona',
          status: SourceEntryStatus.ACTIVE,
          matchedBy: ItemSourceMatch.MANUAL,
          confidence: 1,
          itemId: '5efa0000-0000-4000-a000-00000000d001',
          decidedAt: new Date(),
        })
      );
      const rejected = await entries.save(
        row({
          externalId: 'k-rejected',
          name: 'Rechazada por una persona',
          status: SourceEntryStatus.REJECTED,
          decidedAt: new Date(),
        })
      );
      const touched = await entries.save(
        row({
          externalId: 'k-touched',
          name: 'Existía antes',
          firstRunId: LATER_RUN,
          timesSeen: 4,
        })
      );
      await prices.save([
        prices.create({
          entryId: accepted.id,
          priceScopeId: NORTH,
          price: 0.53,
          currency: 'EUR',
          runId: RUN,
        }),
        prices.create({
          entryId: touched.id,
          priceScopeId: NORTH,
          price: 0.61,
          currency: 'EUR',
          runId: LATER_RUN,
        }),
      ]);

      const observed = await rows.deleteObservedPricesFrom(RUN);
      const undecidedRows = await rows.deleteUndecidedFrom(RUN);

      expect({ prices: observed, entries: undecidedRows }).toEqual({
        prices: 1,
        entries: 1,
      });
      const left = await entries.find({ where: { supermarketId: CHAIN } });
      expect(left.map((each) => each.externalId).sort()).toEqual([
        // A row a later run observed again is a real product that run stands
        // behind, and deleting it would take its observation with it.
        'k-accepted',
        'k-rejected',
        'k-seen-again',
        'k-touched',
      ]);
      expect(left.find((each) => each.id === undecided.id)).toBeUndefined();
      expect(left.find((each) => each.id === seenAgain.id)).toBeDefined();
      expect(left.find((each) => each.id === rejected.id)).toBeDefined();

      // The touched row keeps its count and its timestamp: undoing them would
      // invent a past in which the chain never listed the product.
      const held = left.find((each) => each.id === touched.id);
      expect(held?.timesSeen).toBe(4);
      // The later run's own price observation survives, and this run's does not.
      const remaining = await prices.find({ where: { runId: LATER_RUN } });
      expect(remaining).toHaveLength(1);
      expect(await prices.find({ where: { runId: RUN } })).toEqual([]);
    });
  });

  describe('the one category path of a product (plan 0268)', () => {
    /** The import over the real ingest, as `RunExecutor` builds it. */
    function importer(): FileImportRunner {
      const catalog = {
        listAllPriceScopes: async () => [],
        searchItems: async () => ({ items: [], nextCursor: null }),
        addPrices: async () => ({ written: 0, confirmed: 0, declined: [] }),
        findItemByEan: async () => ({ item: null }),
      } as unknown as CatalogClient;
      return new FileImportRunner(
        new SourceIngest(entries, prices, catalog),
        new PriceScopeResolver(catalog)
      );
    }

    function importContext(document: HarvestDocument): RunContext {
      return {
        runId: RUN,
        run: { id: RUN, input: { document } },
        signal: new AbortController().signal,
        setStage: async () => undefined,
        setTotalPlanned: async () => undefined,
        report: async () => undefined,
        advance: async () => undefined,
        warn: () => undefined,
        flush: async () => undefined,
      } as unknown as RunContext;
    }

    it('adds the document path after the stored ones, and writes none for a product with none', async () => {
      const WALKED = ['Alimentación', 'Bebidas', 'Cervezas'];
      const LEAFLET = ['Bebidas'];
      const known = await entries.save(
        row({
          externalId: entryKey('Cerveza Alhambra Tradicional', 'lata 33 cl'),
          categoryPaths: [WALKED],
        })
      );

      const counters = await importer().run(
        importContext({
          schema_version: 1,
          sha256: DIGEST,
          producer: { name: MARK, produced_at: '2026-09-04T18:02:11Z' },
          products: [
            {
              name: 'Cerveza Alhambra Tradicional',
              size: { label: 'lata 33 cl' },
              category_path: LEAFLET,
            },
            { name: 'Pan de molde', size: { label: '500 g' } },
          ],
        }),
        {
          supermarketId: CHAIN,
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          adapterKey: null,
        }
      );

      const stored = await entries.find({ where: { supermarketId: CHAIN } });
      const byName = new Map(stored.map((each) => [each.name, each]));
      // ADD: one leaflet has not shown that the walked shelf is gone.
      expect(byName.get(known.name)?.categoryPaths).toEqual([WALKED, LEAFLET]);
      // A row the import created keeps the column default until a path
      // is written, and a product with none writes none.
      expect(byName.get('Pan de molde')?.categoryPaths).toEqual([]);
      expect(counters.categoryPathsWritten).toBe(1);
    });
  });

  describe('the round trip of an export (plan 0086, section 6.2)', () => {
    const SOURCE_RUN = '5efa0000-0000-4000-a000-00000000c101';
    const TARGET_RUN = '5efa0000-0000-4000-a000-00000000c102';
    const ITEM = '5efa0000-0000-4000-a000-00000000d101';
    const PHOTO = 'https://prod-mercadona.imgix.net/images/4241.jpg?fit=crop';
    const LINK = 'https://tienda.mercadona.es/product/4241/leche-entera';
    const DAIRY = ['Lácteos', 'Leche y bebidas vegetales', 'Leche entera'];
    const BREAKFAST = ['Desayuno', 'Leche'];
    const WRONG = ['Bebidas', 'Refrescos'];

    /** What catalog was sent, recorded rather than answered by a stub. */
    let linked: { sourceEntryId: string; url: string }[];
    let unlinked: string[];
    let owed: { observedAt?: string; price?: number | null }[];

    beforeEach(() => {
      linked = [];
      unlinked = [];
      owed = [];
    });

    function importer(): FileImportRunner {
      const catalog = {
        listAllPriceScopes: async () => [],
        searchItems: async () => ({ items: [], nextCursor: null }),
        addPrices: async (_scope: string, entries: typeof owed) => {
          owed.push(...entries);
          return { inserted: entries.length, confirmed: 0, declined: [] };
        },
        findItemByEan: async () => ({ item: null }),
        linkItemImages: async (links: typeof linked) => {
          linked.push(...links);
          return {
            linked: links.length,
            moved: 0,
            unchanged: 0,
            rejected: [],
          };
        },
        unlinkItemImages: async (ids: string[]) => {
          unlinked.push(...ids);
          return { unlinked: ids.length };
        },
      } as unknown as CatalogClient;
      return new FileImportRunner(
        new SourceIngest(entries, prices, catalog),
        new PriceScopeResolver(catalog)
      );
    }

    function importContext(document: HarvestDocument): RunContext {
      return {
        runId: RUN,
        run: { id: RUN, input: { document } },
        signal: new AbortController().signal,
        setStage: async () => undefined,
        setTotalPlanned: async () => undefined,
        report: async () => undefined,
        advance: async () => undefined,
        warn: () => undefined,
        flush: async () => undefined,
      } as unknown as RunContext;
    }

    const asWalk = {
      supermarketId: CHAIN,
      priceScopeId: NORTH,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      adapterKey: 'mercadona-api',
    };

    /**
     * A row a walk wrote and a person bound to a product, so the product shows
     * the chain photo, with this run's price of the scope.
     */
    async function walkedRow(
      runId: string,
      patch: Partial<SourceCatalogEntry>,
      price: { amount: number; observedAt: string }
    ): Promise<SourceCatalogEntry> {
      const saved = await entries.save(
        row({
          externalId: '4241',
          name: 'Leche entera Hacendado',
          sizeFormat: 'brik 1 L',
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          status: SourceEntryStatus.ACTIVE,
          itemId: ITEM,
          matchedBy: ItemSourceMatch.MANUAL,
          confidence: 1,
          decidedAt: new Date('2026-10-01T10:00:00Z'),
          brand: 'Hacendado',
          ean: '8480000102412',
          url: LINK,
          imageUrl: PHOTO,
          extra: { packaging: 'Brik' },
          firstRunId: runId,
          lastRunId: runId,
          ...patch,
        })
      );
      await prices.save(
        prices.create({
          entryId: saved.id,
          priceScopeId: NORTH,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          price: price.amount,
          currency: 'EUR',
          observedAt: new Date(price.observedAt),
          runId,
        })
      );
      return saved;
    }

    /** The export of a run, read as `SourceEntryService.exportRun` reads it. */
    async function exportOf(runId: string): Promise<HarvestDocument> {
      const observed = await entries.find({
        where: {
          supermarketId: CHAIN,
          lastRunId: runId,
          prices: { runId },
        },
        relations: { prices: true },
      });
      return buildHarvestDocument({
        run: { id: runId, supermarketId: CHAIN, priceScopeId: NORTH },
        entries: observed,
        producedAt: new Date('2026-11-02T08:00:00Z'),
      });
    }

    /**
     * The target holds the same walked row, from a walk of its own, except
     * that its trail is wrong, and its price is newer than the file's.
     */
    async function target(): Promise<SourceCatalogEntry> {
      return walkedRow(
        TARGET_RUN,
        { categoryPath: WRONG, categoryPaths: [WRONG] },
        { amount: 1.05, observedAt: '2026-11-20T09:00:00Z' }
      );
    }

    async function exported(): Promise<HarvestDocument> {
      await walkedRow(
        SOURCE_RUN,
        { categoryPath: DAIRY, categoryPaths: [DAIRY, BREAKFAST] },
        { amount: 0.95, observedAt: '2026-11-01T09:00:00Z' }
      );
      const document = await exportOf(SOURCE_RUN);
      // The second state is another cluster: nothing of the first survives.
      await clean();
      return document;
    }

    it('keeps the photo linked, the link, the bag and the EAN, and adds the trails', async () => {
      const document = await exported();
      expect(document.products[0]).toMatchObject({
        image_url: PHOTO,
        category_path: DAIRY,
        category_paths: [DAIRY, BREAKFAST],
      });
      const held = await target();

      await importer().run(importContext(document), asWalk);

      const after = await entries.findOneByOrFail({ id: held.id });
      expect(after).toMatchObject({
        imageUrl: PHOTO,
        url: LINK,
        extra: { packaging: 'Brik' },
        ean: '8480000102412',
        brand: 'Hacendado',
        status: SourceEntryStatus.ACTIVE,
        itemId: ITEM,
        // The one path the walk filed it under, as a walk there writes it.
        categoryPath: DAIRY,
        // ADD: no run replaced the source row's paths whole, so the export
        // does not state them complete, and the wrong trail stays beside the
        // two the walk met.
        categoryPaths: [WRONG, DAIRY, BREAKFAST],
      });
      // The bound product keeps its chain photo: its link is sent again, on
      // the address it held, and nothing is unlinked.
      expect(unlinked).toEqual([]);
      expect(linked).toEqual([
        expect.objectContaining({ sourceEntryId: held.id, url: PHOTO }),
      ]);
    });

    it('changes none of them for a plain file that states none', async () => {
      const held = await target();

      await importer().run(
        importContext({
          schema_version: 2,
          sha256: DIGEST,
          producer: { name: MARK, produced_at: '2026-11-21T08:00:00Z' },
          products: [
            {
              external_id: '4241',
              name: 'Leche entera Hacendado',
              size: { label: 'brik 1 L' },
              prices: [{ amount: 1.05, currency: 'EUR' }],
            },
          ],
        }),
        asWalk
      );

      const after = await entries.findOneByOrFail({ id: held.id });
      expect(after).toMatchObject({
        imageUrl: PHOTO,
        url: LINK,
        extra: { packaging: 'Brik' },
        ean: '8480000102412',
        brand: 'Hacendado',
        categoryPath: WRONG,
        categoryPaths: [WRONG],
      });
      expect(unlinked).toEqual([]);
    });

    describe('a row sold by weight (plan 0181)', () => {
      /** A cheese a walk sells by the kilo: no size, the label kept. */
      const KILO: Partial<SourceCatalogEntry> = {
        externalId: '3401',
        name: 'Queso curado Hacendado',
        sizeFormat: '1 kg',
        unitSize: null,
        sizeUnit: null,
        soldByWeight: true,
        ean: '8480000340108',
      };

      it('stays sold by weight through a round trip, on a known row and on a new one', async () => {
        await walkedRow(SOURCE_RUN, KILO, {
          amount: 12.5,
          observedAt: '2026-11-01T09:00:00Z',
        });
        const document = await exportOf(SOURCE_RUN);
        expect(document.products[0]).toMatchObject({ sold_by_weight: true });
        await clean();

        // A cluster that holds the row: the walk there sold it by weight too.
        const held = await walkedRow(TARGET_RUN, KILO, {
          amount: 12.9,
          observedAt: '2026-11-20T09:00:00Z',
        });
        await importer().run(importContext(document), asWalk);

        expect(await entries.findOneByOrFail({ id: held.id })).toMatchObject({
          soldByWeight: true,
          unitSize: null,
          sizeFormat: '1 kg',
        });

        // A cluster that holds nothing: the row the import makes says what
        // the walk said.
        await clean();
        await importer().run(importContext(document), asWalk);

        const [created] = await entries.find({
          where: { supermarketId: CHAIN },
        });
        expect(created).toMatchObject({
          externalId: '3401',
          soldByWeight: true,
          unitSize: null,
        });
      });

      it('keeps the flag for a plain file that does not say, and writes the one it states', async () => {
        const held = await walkedRow(TARGET_RUN, KILO, {
          amount: 12.9,
          observedAt: '2026-11-20T09:00:00Z',
        });
        const plain = (over: Record<string, unknown>): HarvestDocument => ({
          schema_version: 2,
          sha256: DIGEST,
          producer: { name: MARK, produced_at: '2026-11-21T08:00:00Z' },
          products: [
            {
              external_id: '3401',
              name: 'Queso curado Hacendado',
              size: { label: '1 kg' },
              prices: [],
              ...over,
            },
          ],
        });

        await importer().run(importContext(plain({})), asWalk);
        expect(
          (await entries.findOneByOrFail({ id: held.id })).soldByWeight
        ).toBe(true);

        await importer().run(
          importContext(plain({ sold_by_weight: false })),
          asWalk
        );
        expect(
          (await entries.findOneByOrFail({ id: held.id })).soldByWeight
        ).toBe(false);
      });

      it('never holds a size on a row sold by weight, and keeps the piece weight of a file that states no size', async () => {
        const held = await walkedRow(
          TARGET_RUN,
          { ...KILO, approxWeight: 950 },
          { amount: 12.9, observedAt: '2026-11-20T09:00:00Z' }
        );
        const plain = (
          sha256: string,
          over: Record<string, unknown>
        ): HarvestDocument => ({
          schema_version: 2,
          sha256,
          producer: { name: MARK, produced_at: '2026-11-21T08:00:00Z' },
          products: [
            {
              external_id: '3401',
              name: 'Queso curado Hacendado',
              prices: [],
              extra: { basis: 'unit' },
              ...over,
            },
          ],
        });
        const stored = async () => {
          const after = await entries.findOneByOrFail({ id: held.id });
          return {
            soldByWeight: after.soldByWeight,
            unitSize: after.unitSize === null ? null : Number(after.unitSize),
            sizeUnit: after.sizeUnit,
            approxWeight:
              after.approxWeight === null ? null : Number(after.approxWeight),
          };
        };

        // No flag and no size quantity: it says nothing about how the cheese
        // is sold, so the flag and the weight of a piece stay.
        await importer().run(
          importContext(plain(DIGEST, { size: { label: '1 kg' } })),
          asWalk
        );
        expect(await stored()).toEqual({
          soldByWeight: true,
          unitSize: null,
          sizeUnit: null,
          approxWeight: 950,
        });

        // A size quantity and no flag says a fixed pack, as `origin/dev`
        // wrote it: the flag goes false with the size, never true beside it.
        await importer().run(
          importContext(
            plain('b'.repeat(64), {
              size: { label: '500 g', quantity: 500, unit: 'g' },
            })
          ),
          asWalk
        );
        expect(await stored()).toEqual({
          soldByWeight: false,
          unitSize: 500,
          sizeUnit: 'GRAM',
          approxWeight: null,
        });
      });
    });

    it('keeps the size, its unit and its text for a file that states no size, and counts the row unchanged', async () => {
      const held = await walkedRow(
        TARGET_RUN,
        {
          externalId: '9001',
          name: 'Leche',
          sizeFormat: '1 L',
          unitSize: 1000,
          sizeUnit: UnitOfMeasure.MILLILITER,
          soldByWeight: false,
        },
        { amount: 0.99, observedAt: '2026-11-20T09:00:00Z' }
      );

      const counters = await importer().run(
        importContext({
          schema_version: 2,
          sha256: DIGEST,
          producer: { name: MARK, produced_at: '2026-11-21T08:00:00Z' },
          products: [{ external_id: '9001', name: 'Leche', prices: [] }],
        }),
        asWalk
      );

      const after = await entries.findOneByOrFail({ id: held.id });
      expect({
        sizeFormat: after.sizeFormat,
        unitSize: after.unitSize === null ? null : Number(after.unitSize),
        sizeUnit: after.sizeUnit,
      }).toEqual({ sizeFormat: '1 L', unitSize: 1000, sizeUnit: 'MILLILITER' });
      expect(counters).toMatchObject({ unchanged: 1, updated: 0 });
    });

    describe('trails a walk read whole (164a)', () => {
      /** The export of a walk whose drain replaced the row's paths whole. */
      async function exportedWhole(
        patch: Partial<SourceCatalogEntry> = {}
      ): Promise<HarvestDocument> {
        const walked = await walkedRow(
          SOURCE_RUN,
          { categoryPath: DAIRY, ...patch },
          { amount: 0.95, observedAt: '2026-11-01T09:00:00Z' }
        );
        // What the drain of a walk calls for a product it read whole.
        await new SourceIngest(
          entries,
          prices,
          {} as CatalogClient
        ).writeCategoryPaths(SOURCE_RUN, [
          { entryId: walked.id, paths: [DAIRY, BREAKFAST], mode: 'REPLACE' },
        ]);
        const document = await exportOf(SOURCE_RUN);
        await clean();
        return document;
      }

      /** The target's row, with a wrong trail and a price older than the file's. */
      async function wronglyFiled(
        patch: Partial<SourceCatalogEntry> = {}
      ): Promise<SourceCatalogEntry> {
        return walkedRow(
          TARGET_RUN,
          { categoryPath: WRONG, categoryPaths: [WRONG], ...patch },
          { amount: 1.05, observedAt: '2026-10-20T09:00:00Z' }
        );
      }

      it('replaces the wrong trail of the target, names the import on it, and its export says so again', async () => {
        const document = await exportedWhole();
        expect(document.products[0]).toMatchObject({
          category_paths: [DAIRY, BREAKFAST],
          category_paths_complete: true,
        });
        const held = await wronglyFiled();

        const counters = await importer().run(importContext(document), asWalk);

        expect(await entries.findOneByOrFail({ id: held.id })).toMatchObject({
          categoryPath: DAIRY,
          categoryPaths: [DAIRY, BREAKFAST],
          categoryPathsReplacedByRunId: RUN,
        });
        expect(counters.categoryPathsWritten).toBe(1);
        // The import's own export carries the statement on.
        const again = await exportOf(RUN);
        expect(again.products[0]).toMatchObject({
          category_paths: [DAIRY, BREAKFAST],
          category_paths_complete: true,
        });
      });

      it('only adds for a product that does not state its paths whole', async () => {
        const document = await exportedWhole();
        const plain = {
          ...document,
          products: document.products.map((product) => {
            const rest = { ...product };
            delete rest.category_paths_complete;
            return rest;
          }),
        };
        const held = await wronglyFiled({
          categoryPathsReplacedByRunId: TARGET_RUN,
        });

        await importer().run(importContext(plain), asWalk);

        expect(await entries.findOneByOrFail({ id: held.id })).toMatchObject({
          categoryPaths: [WRONG, DAIRY, BREAKFAST],
          categoryPathsReplacedByRunId: TARGET_RUN,
        });
      });

      it('never replaces through an import of a leaflet kind', async () => {
        const document = await exportedWhole();
        const held = await wronglyFiled();

        await importer().run(importContext(document), {
          ...asWalk,
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        });

        const after = await entries.findOneByOrFail({ id: held.id });
        expect(after.categoryPaths).toEqual([WRONG, DAIRY, BREAKFAST]);
        expect(after.categoryPathsReplacedByRunId).toBeNull();
      });

      it('states nothing whole for a row whose paths another run replaced', async () => {
        const walked = await walkedRow(
          SOURCE_RUN,
          { categoryPath: DAIRY, categoryPaths: [DAIRY] },
          { amount: 0.95, observedAt: '2026-11-01T09:00:00Z' }
        );
        await new SourceIngest(
          entries,
          prices,
          {} as CatalogClient
        ).writeCategoryPaths(LATER_RUN, [
          { entryId: walked.id, paths: [DAIRY], mode: 'REPLACE' },
        ]);

        const document = await exportOf(SOURCE_RUN);

        expect(Object.keys(document.products[0])).not.toContain(
          'category_paths_complete'
        );
      });
    });

    describe('a price older than the one the row holds (165a)', () => {
      it('is skipped and counted, and the rest of the product is written', async () => {
        const document = await exported();
        const held = await target();

        const counters = await importer().run(importContext(document), asWalk);

        const stored = await prices.find({
          where: {
            entryId: held.id,
            priceScopeId: NORTH,
            sourceKind: PriceSourceKind.OFFICIAL_WEB,
          },
        });
        expect(stored).toHaveLength(1);
        expect(Number(stored[0].price)).toBe(1.05);
        expect(stored[0].observedAt.toISOString()).toBe(
          '2026-11-20T09:00:00.000Z'
        );
        expect(stored[0].runId).toBe(TARGET_RUN);
        // Catalog is sent no current observation for it.
        expect(owed).toEqual([]);
        expect(counters).toMatchObject({
          pricesSkippedOlder: 1,
          pricesRecorded: 0,
        });
        // The trails of the file are still added.
        expect(
          (await entries.findOneByOrFail({ id: held.id })).categoryPaths
        ).toEqual([WRONG, DAIRY, BREAKFAST]);
      });

      it('writes a newer one, and one at the same instant', async () => {
        const document = await exported();
        const held = await walkedRow(
          TARGET_RUN,
          { categoryPath: WRONG, categoryPaths: [WRONG] },
          { amount: 1.05, observedAt: '2026-10-20T09:00:00Z' }
        );

        const newer = await importer().run(importContext(document), asWalk);

        const [stored] = await prices.find({
          where: { entryId: held.id, sourceKind: PriceSourceKind.OFFICIAL_WEB },
        });
        expect(Number(stored.price)).toBe(0.95);
        expect(stored.observedAt.toISOString()).toBe(
          '2026-11-01T09:00:00.000Z'
        );
        expect(newer.pricesSkippedOlder).toBe(0);
        expect(owed).toEqual([
          expect.objectContaining({
            price: 0.95,
            observedAt: '2026-11-01T09:00:00.000Z',
          }),
        ]);

        // The same file again: an equal instant writes, as before.
        const same = await importer().run(
          importContext({ ...document, sha256: 'b'.repeat(64) }),
          asWalk
        );
        expect(same.pricesSkippedOlder).toBe(0);
        expect(same.pricesRecorded).toBe(1);
      });
    });
  });
});
