import type { ConfigService } from '@nestjs/config';
import {
  PriceScopeKind,
  PriceSourceKind,
  SourceEntryStatus,
  type ItemPriceBatchEntry,
  type PriceScopeView,
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
  type SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { MercadonaCatalogRunner } from './mercadona-catalog.runner';
import { PriceScopeResolver } from './price-scope-resolver';
import type { RunContext } from './run-context';
import { RunReportSink } from './run-report.sink';
import { SourceEntryService } from './source-entry.service';
import { SourceIngest } from './source-ingest';

/**
 * One Mercadona warehouse walked and written to three more scopes, against real
 * Postgres (plan 0118, section 10).
 *
 * The walk runs over a stubbed `fetch`, so nothing leaves the machine: a tree
 * of one category holding two products, one of which an EAN binds to a catalog
 * item. What this proves and a mocked repository cannot is the shape of the
 * write: `source_entry_prices` is unique on (entry, scope), so four scopes of
 * one product either land four rows or violate that constraint, and the revert
 * deletes by `runId`, which a copy has to carry to go with it.
 *
 * Catalog is another service behind the broker. Its half, the copied row and
 * its materialized provenance, is `item-prices.integration.spec.ts`.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('scope copies of a Mercadona walk (real Postgres)', () => {
  /** A chain nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '0118c0de-0000-4000-8000-111111111111';
  const RUN = '0118c0de-0000-4000-8000-222222222222';
  const WALKED = '0118c0de-0000-4000-8000-333333333301';
  const TARGETS = [
    '0118c0de-0000-4000-8000-333333333302',
    '0118c0de-0000-4000-8000-333333333303',
    '0118c0de-0000-4000-8000-333333333304',
  ];
  const BASE = 'https://fixtures.test/api';
  const EAN = '8480000135636';
  const ITEM = '0118c0de-0000-4000-8000-444444444444';

  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let prices: Repository<SourceEntryPrice>;
  let restoreFetch: (() => void) | undefined;

  /** What catalog was sent, per call. */
  let sentPrices: {
    priceScopeId: string;
    entries: ItemPriceBatchEntry[];
    sourceRunId: string | null;
    copiedFromScopeId: string | null;
  }[];
  let sentAvailability: { priceScopeId: string; count: number }[];

  const catalog = {
    listAllPriceScopes: async (): Promise<PriceScopeView[]> =>
      [WALKED, ...TARGETS].map((id, index) => ({
        id,
        supermarketId: CHAIN,
        kind: PriceScopeKind.REGION,
        // Only the walked warehouse carries a key. A target needs none.
        externalKey: index === 0 ? '4661' : null,
        label: null,
        priority: 300,
      })),
    searchItems: async () => ({
      items: [
        {
          id: ITEM,
          name: { es: 'Aceite de oliva', en: null },
          brand: 'Hacendado',
          ean: EAN,
          unitSize: 1,
        },
      ],
      nextCursor: null,
    }),
    addPrices: async (
      priceScopeId: string,
      batch: ItemPriceBatchEntry[],
      sourceRunId: string | null,
      _sourceKind: PriceSourceKind,
      copiedFromScopeId: string | null = null
    ) => {
      sentPrices.push({
        priceScopeId,
        entries: batch,
        sourceRunId,
        copiedFromScopeId,
      });
      return { inserted: batch.length, confirmed: 0 };
    },
    setAvailability: async (
      priceScopeId: string,
      batch: readonly unknown[]
    ) => {
      sentAvailability.push({ priceScopeId, count: batch.length });
      return { updated: batch.length };
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
    sentPrices = [];
    sentAvailability = [];
    await clean();
    restoreFetch = stubFetch();
  });

  afterEach(() => {
    restoreFetch?.();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  async function clean(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "source_entry_prices" WHERE "entryId" IN
         (SELECT id FROM "source_catalog_entries" WHERE "supermarketId" = $1)`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
  }

  /** One whole walk of warehouse 4661, copied to the three targets. */
  async function walk(): Promise<void> {
    const context = {
      runId: RUN,
      signal: new AbortController().signal,
      acquire: async () => undefined,
      setStage: async () => undefined,
      setReport: async () => undefined,
      setTotalPlanned: async () => undefined,
      report: async () => undefined,
      heartbeat: async () => undefined,
      flush: async () => undefined,
      warn: () => undefined,
    } as unknown as RunContext;
    const sink = new RunReportSink(
      context,
      {
        supermarketId: CHAIN,
        defaultPriceScopeId: null,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        postalCodeDeriveMaxMetres: 5000,
        autoImportPlaces: false,
        copiesOf: (scopeId) => (scopeId === WALKED ? TARGETS : []),
      },
      {
        ingest: new SourceIngest(entries, prices, catalog),
        scopes: new PriceScopeResolver(catalog).forRun(CHAIN, 'mercadona-api'),
        places: {} as never,
        shops: {} as never,
        catalog,
        entries,
      }
    );
    const runner = new MercadonaCatalogRunner({
      getOrThrow: () => ({ userAgent: 'test', mercadonaBaseUrl: BASE }),
    } as unknown as ConfigService);
    await runner.run(
      context,
      sink,
      {
        supermarketId: CHAIN,
        priceScopes: [{ id: WALKED, externalKey: '4661' }],
      },
      {
        adapterKey: 'mercadona-api',
        workers: 1,
        config: {},
      } as unknown as SupermarketSource
    );
    const written = await sink.drain();
    expect(written.pricedScopes).toEqual([WALKED]);
  }

  it('writes each product at the walked scope and at every target, each copy naming its source', async () => {
    await walk();

    const rows = await entries.find({ where: { supermarketId: CHAIN } });
    expect(rows).toHaveLength(2);
    const bound = rows.find((row) => row.status === SourceEntryStatus.ACTIVE);
    expect(bound?.itemId).toBe(ITEM);

    for (const row of rows) {
      const held = await prices.find({ where: { entryId: row.id } });
      expect(
        held
          .map((price) => [price.priceScopeId, price.copiedFromScopeId])
          .sort()
      ).toEqual(
        [[WALKED, null], ...TARGETS.map((target) => [target, WALKED])].sort()
      );
      expect(held.every((price) => price.runId === RUN)).toBe(true);
      expect(new Set(held.map((price) => Number(price.price)))).toEqual(
        new Set([8.75])
      );
    }

    // Only the bound product is owed a catalog price, at all four scopes.
    expect(
      sentPrices
        .map((call) => [call.priceScopeId, call.copiedFromScopeId])
        .sort()
    ).toEqual(
      [[WALKED, null], ...TARGETS.map((target) => [target, WALKED])].sort()
    );
    expect(sentPrices.every((call) => call.sourceRunId === RUN)).toBe(true);
    // The whole assortment was walked, so its availability is copied too.
    expect(sentAvailability.map((call) => call.priceScopeId).sort()).toEqual(
      [WALKED, ...TARGETS].sort()
    );
  });

  it('a second walk replaces the copied rows rather than adding to them', async () => {
    await walk();
    await walk();

    const rows = await entries.find({ where: { supermarketId: CHAIN } });
    for (const row of rows) {
      expect(await prices.count({ where: { entryId: row.id } })).toBe(4);
    }
  });

  it('a revert of the run removes every copy it wrote (section 8)', async () => {
    await walk();
    const service = new SourceEntryService(
      entries,
      prices,
      undefined as never,
      catalog,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never
    );

    const deleted = await service.deleteObservedPricesFrom(RUN);

    expect(deleted).toBe(8);
    const rows = await entries.find({ where: { supermarketId: CHAIN } });
    for (const row of rows) {
      expect(await prices.count({ where: { entryId: row.id } })).toBe(0);
    }
  });

  /**
   * A `fetch` over a tree of one category holding two products. `4241` states
   * the EAN a catalog item carries and `7012` states none, so one row binds and
   * one waits in the queue.
   */
  function stubFetch(): () => void {
    const listed = (id: string) => ({
      id,
      slug: `producto-${id}`,
      display_name: `Producto ${id}`,
      published: true,
      share_url: `https://fixtures.test/product/${id}`,
      price_instructions: {
        size_format: 'l',
        unit_price: '8.75',
        bulk_price: '8.75',
        unit_size: 1,
        reference_format: 'L',
      },
    });
    const answer = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
      }) as unknown as Response;
    const held = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(`${BASE}/categories/?`)) {
        return answer({
          next: null,
          previous: null,
          results: [
            {
              id: 12,
              name: 'Aceite, especias y salsas',
              order: 1,
              published: true,
              categories: [
                { id: 112, name: 'Aceite', order: 1, published: true },
              ],
            },
          ],
        });
      }
      if (/\/categories\/\d+\//.test(url)) {
        return answer({
          id: 112,
          name: 'Aceite',
          order: 1,
          published: true,
          categories: [
            {
              id: 113,
              name: 'Aceite de oliva',
              order: 1,
              published: true,
              products: [listed('4241'), listed('7012')],
            },
          ],
        });
      }
      const product = /\/products\/([^/?]+)\//.exec(url);
      if (product) {
        return answer({
          ...listed(product[1]),
          ean: product[1] === '4241' ? EAN : null,
          brand: 'Hacendado',
          categories: [
            {
              id: 12,
              name: 'Aceite, especias y salsas',
              level: 0,
              categories: [{ id: 112, name: 'Aceite', level: 1 }],
            },
          ],
        });
      }
      throw new Error(`No fixture for ${url}`);
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = held;
    };
  }
});
