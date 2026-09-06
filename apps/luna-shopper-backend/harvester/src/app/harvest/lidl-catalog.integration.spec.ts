import type { ConfigService } from '@nestjs/config';
import {
  PriceScopeKind,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import { LidlClient } from '@portfolio/luna-shopper/lidl';
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
import { LidlCatalogRunner } from './lidl-catalog.runner';
import type { RunContext } from './run-context';
import { SourceIngest } from './source-ingest';

/**
 * One product, two regional prices, two scopes, against real Postgres (plan
 * 0089, section 12).
 *
 * The unit spec asserts that the runner makes one ingest call per scope. This
 * asserts what those calls leave behind, and it needs a database because the
 * thing being tested is the shape of the write: `source_entry_prices` is unique
 * on (entry, scope), so a run that wrote both prices for one product either
 * lands two rows or violates that constraint. A mocked repository cannot tell
 * you which.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('LIDL catalog run (real Postgres)', () => {
  /** A chain nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '0de11d10-0000-4000-8000-111111111111';

  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let prices: Repository<SourceEntryPrice>;
  let runner: LidlCatalogRunner;

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

    // Catalog is another service behind the broker, and what this spec is about
    // is the harvester's own write. The scopes it hands back are the ones the
    // run would have created there.
    const catalog = {
      listPriceScopes: async () => ({ items: [], nextCursor: null }),
      createPriceScope: async (
        supermarketId: string,
        kind: PriceScopeKind,
        externalKey: string | null
      ) =>
        ({
          id: scopeIdFor(externalKey),
          supermarketId,
          kind,
          externalKey,
          label: null,
        }) as PriceScopeView,
      searchItems: async () => ({ items: [], nextCursor: null }),
      addPrices: async () => ({ written: 0, confirmed: 0, declined: [] }),
      findItemByEan: async () => ({ item: null }),
    } as unknown as CatalogClient;

    runner = new TestRunner(
      new SourceIngest(entries, prices, catalog),
      catalog
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
      `DELETE FROM "source_entry_prices" WHERE "entryId" IN
         (SELECT id FROM "source_catalog_entries" WHERE "supermarketId" = $1)`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
  }

  it('writes one row for the product and one price row per scope', async () => {
    await runner.run(context(), { supermarketId: CHAIN }, source());

    const rows = await entries.find({ where: { supermarketId: CHAIN } });
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe('1');
    expect(rows[0].ean).toBe('4335619207615');

    const written = await prices.find({ where: { entryId: rows[0].id } });
    const byScope = new Map(
      written.map((price) => [price.priceScopeId, Number(price.price)])
    );
    // The mainland regions pay one price and the island region pays another,
    // and both are stored: a model that kept one row per product could hold
    // only whichever scope the run wrote last (plan 0086, D3).
    expect(byScope.get(scopeIdFor('1'))).toBe(74.99);
    expect(byScope.get(scopeIdFor('2'))).toBe(74.99);
    expect(byScope.get(scopeIdFor('58'))).toBe(77.99);
    expect(written).toHaveLength(3);
  });

  it('replaces its own price rows when the run is repeated', async () => {
    await runner.run(context(), { supermarketId: CHAIN }, source());
    await runner.run(context(), { supermarketId: CHAIN }, source());

    const rows = await entries.find({ where: { supermarketId: CHAIN } });
    expect(rows).toHaveLength(1);
    // Weekly is the cadence this source is read at, so the second run of the
    // same window must not double every price row it already wrote.
    expect(await prices.count({ where: { entryId: rows[0].id } })).toBe(3);
  });
});

/** A scope id derived from the region, so the assertions can name one. */
function scopeIdFor(externalKey: string | null): string {
  return `0de11d10-0000-4000-8000-3333333333${String(externalKey ?? '0').padStart(2, '0')}`;
}

/** The runner, over a fetch that answers one index page and one product page. */
class TestRunner extends LidlCatalogRunner {
  constructor(ingest: SourceIngest, catalog: CatalogClient) {
    super(ingest, catalog, {
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): LidlClient {
    return new LidlClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      fetchImpl: (async (url: string) => {
        const address = new URL(String(url));
        if (address.pathname.startsWith('/q/api/search')) {
          const offset = Number(address.searchParams.get('offset') ?? 0);
          return new Response(
            JSON.stringify({
              numFound: 1,
              offset,
              items: offset === 0 ? [INDEX_ROW] : [],
            }),
            { status: 200 }
          );
        }
        return new Response(PRODUCT_PAGE, { status: 200 });
      }) as unknown as typeof fetch,
    });
  }
}

const INDEX_ROW = {
  gridbox: {
    data: {
      productId: '1',
      category: 'Food',
      canonicalPath: '/p/x/p1',
      brand: { name: 'Parkside' },
      keyfacts: {
        title: 'Nevera móvil recargable',
        wonCategoryPrimary:
          'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Queso',
      },
      price: { price: 74.99, packaging: { text: '500 g' } },
    },
  },
};

/** The same shape the unit spec builds, flattened the way the page ships it. */
const PRODUCT_PAGE = (() => {
  const state = {
    pinia: {
      products: {
        byId: {
          '1': {
            productId: '1',
            eans: ['4335619207615'],
            canonicalPath: '/p/x/p1',
            keyfacts: {
              title: 'Nevera móvil recargable',
              wonCategoryPrimary:
                'Mundos de necesidad/Comida y cerca de la comida/Quesos, productos lácteos y huevos/Queso',
            },
            price: { packaging: { text: '500 g' } },
            storeFacts: { retail: true, online: false },
            regionsV2: {
              '1': { regionName: 'A Coruña', regionPriceId: 'mainland' },
              '2': { regionName: 'Pontevedra', regionPriceId: 'mainland' },
              '58': { regionName: 'Las Palmas', regionPriceId: 'islands' },
            },
            regionsPrices: {
              mainland: {
                currentPrice: {
                  price: 74.99,
                  currencyCode: 'EUR',
                  startDate: '2026-09-03T22:00Z',
                  endDate: '2026-09-06T21:59:59Z',
                },
              },
              islands: {
                currentPrice: {
                  price: 77.99,
                  currencyCode: 'EUR',
                  startDate: '2026-09-03T22:00Z',
                  endDate: '2026-09-06T21:59:59Z',
                },
              },
            },
          },
        },
      },
    },
  };
  const flat: unknown[] = [];
  const index = (node: unknown): number => {
    if (node === null || typeof node !== 'object') {
      flat.push(node);
      return flat.length - 1;
    }
    const slot = flat.length;
    flat.push(null);
    if (Array.isArray(node)) {
      flat[slot] = node.map(index);
    } else {
      const out: Record<string, number> = {};
      for (const [key, nested] of Object.entries(node)) {
        out[key] = index(nested);
      }
      flat[slot] = out;
    }
    return slot;
  };
  index(state);
  return `<html><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(
    flat
  )}</script></html>`;
})();

function context(): RunContext {
  return {
    runId: '0de11d10-0000-4000-8000-222222222222',
    run: { id: '0de11d10-0000-4000-8000-222222222222' },
    signal: new AbortController().signal,
    acquire: async () => undefined,
    setStage: async () => undefined,
    setTotalPlanned: async () => undefined,
    setReport: async () => undefined,
    report: async () => undefined,
    flush: async () => undefined,
    warn: () => undefined,
  } as unknown as RunContext;
}

const source = (): SupermarketSource =>
  ({ adapterKey: 'lidl-api', config: {}, workers: 1 }) as SupermarketSource;
