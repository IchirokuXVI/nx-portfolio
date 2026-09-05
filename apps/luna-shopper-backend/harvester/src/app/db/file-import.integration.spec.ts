import {
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from '../harvest/catalog-client.service';
import type { PlatformAdminService } from '../harvest/platform-admin.service';
import { SourceEntryService } from '../harvest/source-entry.service';
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
    // The two revert methods touch the three repositories and nothing else, so
    // the collaborators an accept needs are deliberately absent: a call that
    // reached one would fail loudly rather than pass on a stub.
    rows = new SourceEntryService(
      entries,
      prices,
      runs,
      undefined as unknown as CatalogClient,
      undefined as unknown as SupermarketSourceService,
      undefined as unknown as PlatformAdminService,
      undefined as unknown as ConfigService
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
      const elsewhere = await entries.save(
        row({ supermarketId: OTHER_CHAIN })
      );
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

    it('replaces a scope its own row rather than adding a second', async () => {
      const entry = await entries.save(row());
      const first = prices.create({
        entryId: entry.id,
        priceScopeId: NORTH,
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
            price: 0.59,
            currency: 'EUR',
            runId: LATER_RUN,
          })
        )
      ).rejects.toThrow(/uq_source_entry_prices_scope/);

      // Which is why the ingest upserts on that pair.
      await prices.upsert(
        [
          {
            entryId: entry.id,
            priceScopeId: NORTH,
            price: 0.59,
            currency: 'EUR',
            runId: LATER_RUN,
          },
        ],
        { conflictPaths: ['entryId', 'priceScopeId'] }
      );
      const held = await prices.find({ where: { entryId: entry.id } });
      expect(held).toHaveLength(1);
      expect(Number(held[0].price)).toBe(0.59);
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
});
