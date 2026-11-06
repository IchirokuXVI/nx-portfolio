import {
  PriceSourceKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';
import {
  SourceIngest,
  type PartialSourceObservation,
  type SourceObservation,
} from './source-ingest';

/**
 * The weight of one piece, as the ingest writes it onto a row (plan 0244,
 * section 5.5), against real Postgres.
 *
 * Two things a fake cannot prove: that every write the ingest makes keeps
 * `chk_source_catalog_entries_approx_weight` (no weight beside a size), and
 * that a weight Postgres answers as text (`"1540.0000"`) reads as the same
 * weight, so a run that sees it again counts the row `unchanged`.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/** A chain nothing else in this database uses, so cleanup is exact. */
const CHAIN = 'b2440000-0000-4000-a000-000000000001';
const SCOPE = 'd2440000-0000-4000-a000-000000000001';
const RUN = 'e2440000-0000-4000-a000-000000000001';

describeIntegration(
  'the weight of one piece on a source row (real Postgres)',
  () => {
    let dataSource: DataSource;
    let ingest: SourceIngest;

    const context = {
      runId: RUN,
      report: async () => undefined,
      advance: async () => undefined,
      warn: () => undefined,
    } as unknown as RunContext;

    const session = {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    };

    const whole = (over: Partial<SourceObservation>): SourceObservation => ({
      externalId: '50946',
      name: 'Queso semicurado mezcla Hacendado',
      brand: 'Hacendado',
      ean: null,
      unitSize: null,
      sizeUnit: null,
      sizeFormat: 'kg',
      categoryPath: [],
      url: null,
      imageUrl: null,
      observedAt: new Date('2026-11-05T06:00:00.000Z'),
      extra: null,
      prices: [],
      ...over,
    });

    const partial = (
      over: Partial<PartialSourceObservation>
    ): PartialSourceObservation => ({
      externalId: '50946',
      detailFetched: false,
      observedAt: new Date('2026-11-05T06:00:00.000Z'),
      prices: [],
      ...over,
    });

    const stored = async (externalId = '50946') =>
      (await dataSource.query(
        `SELECT "unitSize", "sizeUnit", "soldByWeight", "approxWeight"
           FROM "source_catalog_entries"
          WHERE "supermarketId" = $1 AND "externalId" = $2`,
        [CHAIN, externalId]
      )) as {
        unitSize: string | null;
        sizeUnit: string | null;
        soldByWeight: boolean;
        approxWeight: string | null;
      }[];

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('HARVESTER_DB_URL'),
        entities: HARVESTER_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();
      const catalog = {
        searchItems: async () => ({ items: [], nextCursor: null }),
        addPrices: async () => ({ inserted: 0, confirmed: 0 }),
      } as unknown as CatalogClient;
      ingest = new SourceIngest(
        dataSource.getRepository(SourceCatalogEntry),
        dataSource.getRepository(SourceEntryPrice),
        catalog
      );
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await clean();
        await dataSource.destroy();
      }
    });

    beforeEach(() => clean());

    function clean() {
      return dataSource.query(
        `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
        [CHAIN]
      );
    }

    it('writes the weight of a piece sold by weight, and a null weight beside a size', async () => {
      await ingest.ingest(context, {
        ...session,
        observations: [
          whole({
            unitSize: 1.54,
            sizeUnit: UnitOfMeasure.KILOGRAM,
            soldByWeight: true,
            approxWeight: 1540,
          }),
          whole({
            externalId: '4241',
            name: 'Aceite',
            unitSize: 1,
            sizeUnit: UnitOfMeasure.LITER,
            sizeFormat: 'l',
            // A size wins, so the weight is not written beside it.
            approxWeight: 900,
          }),
        ],
      });

      expect(await stored()).toEqual([
        {
          unitSize: null,
          sizeUnit: null,
          soldByWeight: true,
          approxWeight: '1540.0000',
        },
      ]);
      expect(await stored('4241')).toEqual([
        {
          unitSize: '1.0000',
          sizeUnit: 'LITER',
          soldByWeight: false,
          approxWeight: null,
        },
      ]);
    }, 60_000);

    it('reads its own stored weight as the same weight, and counts the row unchanged', async () => {
      const piece = whole({ soldByWeight: true, approxWeight: 1540 });
      await ingest.ingest(context, { ...session, observations: [piece] });

      const again = await ingest.ingest(context, {
        ...session,
        observations: [
          piece,
          partial({ soldByWeight: true, approxWeight: 1540 }),
        ],
      });

      expect(again.counters).toMatchObject({ updated: 0, unchanged: 2 });
    }, 60_000);

    it('lets a partial observation carry a weight onto a sized row, clearing the size', async () => {
      // The piece of 7.2: a row written as a fixed pack of 0.58 kg.
      await ingest.ingest(context, {
        ...session,
        observations: [
          whole({ unitSize: 0.58, sizeUnit: UnitOfMeasure.KILOGRAM }),
        ],
      });

      await ingest.ingest(context, {
        ...session,
        observations: [partial({ soldByWeight: false, approxWeight: 580 })],
      });

      expect(await stored()).toEqual([
        {
          unitSize: null,
          sizeUnit: null,
          soldByWeight: false,
          approxWeight: '580.0000',
        },
      ]);

      // Null from the listing clears it, and absent leaves it alone.
      await ingest.ingest(context, {
        ...session,
        observations: [partial({})],
      });
      expect((await stored())[0].approxWeight).toBe('580.0000');
      await ingest.ingest(context, {
        ...session,
        observations: [partial({ approxWeight: null })],
      });
      expect((await stored())[0].approxWeight).toBeNull();
    }, 60_000);

    it('writes a size over a stored weight, and clears the weight with it', async () => {
      await ingest.ingest(context, {
        ...session,
        observations: [whole({ approxWeight: 580 })],
      });

      await ingest.ingest(context, {
        ...session,
        observations: [
          whole({ unitSize: 0.58, sizeUnit: UnitOfMeasure.KILOGRAM }),
        ],
      });

      expect(await stored()).toEqual([
        {
          unitSize: '0.5800',
          sizeUnit: 'KILOGRAM',
          soldByWeight: false,
          approxWeight: null,
        },
      ]);
    }, 60_000);
  }
);
