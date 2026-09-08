import {
  ADMIN_DASHBOARD_WINDOW_DAYS,
  ItemCategory,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type AdminDashboardRequest,
  type AdminDashboardWindow,
  type DailyCount,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  ItemPrice,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { CatalogDashboardService } from './dashboard.service';
import { PlatformAdminService } from './platform-admin.service';

/**
 * Catalog's dashboard block against real Postgres (plan 0088, section 7).
 *
 * **The counts are SQL and nothing else.** Every number is a
 * `count(*) FILTER (WHERE ...)` and the prices chart is one `GROUP BY` over a
 * day and a source kind, so a fake repository would only assert that the spec's
 * own arithmetic agrees with itself. What is worth proving is that the filters
 * name columns Postgres has, that the grouping buckets a timestamp on the day
 * the window means, and that a table holding two rows still answers a full
 * window for every kind in the enum.
 *
 * The window is a fixed pair of days rather than one derived from today, so a
 * price seeded on the first day of the window stays on the first day of the
 * window whenever the suite runs.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own catalog data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0088_catalog_dashboard_test';

/** The admin the stub gate lets through, and the actor on the trail row. */
const OPERATOR = '22222222-2222-4222-8222-222222222222';

/** One day, as `YYYY-MM-DD` in UTC, shifted from another. */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** An instant inside a day, well away from either boundary. */
function at(day: string): Date {
  return new Date(`${day}T06:00:00.000Z`);
}

const WINDOW: AdminDashboardWindow = {
  from: shiftDay('2026-06-30', -(ADMIN_DASHBOARD_WINDOW_DAYS - 1)),
  to: '2026-06-30',
};
const MIDDLE_DAY = shiftDay(WINDOW.to, -12);

const REQUEST: AdminDashboardRequest = {
  userId: OPERATOR,
  adminToken: 'stub',
  window: WINDOW,
};

describeIntegration('catalog’s dashboard block (real Postgres)', () => {
  let dataSource: DataSource;
  let dashboard: CatalogDashboardService;
  let audit: CatalogAuditService;
  let supermarkets: Repository<Supermarket>;
  let locations: Repository<SupermarketLocation>;
  let scopes: Repository<PriceScope>;
  let items: Repository<Item>;
  let groups: Repository<ProductGroup>;
  let supermarketItems: Repository<SupermarketItem>;
  let prices: Repository<ItemPrice>;
  let trail: Repository<CatalogAudit>;

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    supermarkets = dataSource.getRepository(Supermarket);
    locations = dataSource.getRepository(SupermarketLocation);
    scopes = dataSource.getRepository(PriceScope);
    items = dataSource.getRepository(Item);
    groups = dataSource.getRepository(ProductGroup);
    supermarketItems = dataSource.getRepository(SupermarketItem);
    prices = dataSource.getRepository(ItemPrice);
    trail = dataSource.getRepository(CatalogAudit);

    audit = new CatalogAuditService(dataSource);
    // The gate has its own specs and needs a keypair. Here it stands for a
    // request that already carried a live operator token, so the block under
    // test is the counting rather than the signature check.
    const gate = {
      requireAdmin: jest.fn(async () => ({
        kind: 'admin' as const,
        actorId: OPERATOR,
      })),
    } as unknown as PlatformAdminService;

    dashboard = new CatalogDashboardService(
      supermarkets,
      locations,
      items,
      groups,
      supermarketItems,
      prices,
      gate,
      audit
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let chain: Supermarket;
  let scope: PriceScope;
  let item: Item;
  let seq = 0;

  beforeEach(async () => {
    // Children before parents, so the fixture reset does not lean on a cascade.
    for (const repository of [
      prices,
      supermarketItems,
      locations,
      trail,
      items,
      groups,
      scopes,
      supermarkets,
    ]) {
      await repository.createQueryBuilder().delete().execute();
    }

    chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
    );
    scope = await scopes.save(
      scopes.create({
        supermarketId: chain.id,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
        label: null,
      })
    );
    item = await newItem();
  });

  async function newItem(): Promise<Item> {
    seq += 1;
    return items.save(
      items.create({
        name: { en: `Milk ${seq}`, es: `Leche ${seq}` },
        category: ItemCategory.DAIRY,
        defaultUnit: UnitOfMeasure.LITER,
      })
    );
  }

  /**
   * One price a source gave, on a chosen day.
   *
   * `observedAt` is the first observation and `lastObservedAt` equals it on
   * insert, which is what the chart counts. A confirmation moves the second
   * only, and the chart is about what was written.
   */
  async function newPrice(
    day: string,
    sourceKind: PriceSourceKind,
    forItem: Item = item
  ): Promise<ItemPrice> {
    return prices.save(
      prices.create({
        itemId: forItem.id,
        priceScopeId: scope.id,
        sourceKind,
        price: 1.19,
        currency: 'EUR',
        unitPrice: null,
        unitPriceLabel: null,
        observedAt: at(day),
        lastObservedAt: at(day),
        validFrom: null,
        validUntil: null,
        sourceRunId: null,
        lastObservedRunId: null,
        overrides: null,
        protectedUntil: null,
      })
    );
  }

  /**
   * Every day the series names, and the count on each, with the days that hold
   * nothing left out of the comparison object rather than out of the series.
   */
  function expectSeries(
    points: DailyCount[],
    counts: Record<string, number>
  ): void {
    expect(points).toHaveLength(ADMIN_DASHBOARD_WINDOW_DAYS);
    expect(points[0].day).toBe(WINDOW.from);
    expect(points[points.length - 1].day).toBe(WINDOW.to);
    expect(
      Object.fromEntries(
        points
          .filter((point) => point.count > 0)
          .map((point) => [point.day, point.count])
      )
    ).toEqual(counts);
  }

  it('refuses to count anything the gate did not let through', async () => {
    const refused = new Error('that operator token was not accepted');
    const closed = new CatalogDashboardService(
      supermarkets,
      locations,
      items,
      groups,
      supermarketItems,
      prices,
      {
        requireAdmin: jest.fn(async () => {
          throw refused;
        }),
      } as unknown as PlatformAdminService,
      audit
    );

    // Reads of the catalog are open and these numbers are not part of that
    // surface: the dashboard is an operator's screen.
    await expect(closed.dashboard(REQUEST)).rejects.toBe(refused);
  });

  it('counts the catalog it holds, chain by chain and row by row', async () => {
    await supermarkets.save(
      supermarkets.create({ name: { en: 'Other', es: 'Otra' } })
    );
    for (const externalRef of ['node/1', 'node/2', 'node/3']) {
      await locations.save(
        locations.create({
          supermarketId: chain.id,
          priceScopeId: scope.id,
          label: null,
          externalRef,
          externalProvider: 'OSM',
        })
      );
    }
    await newItem();
    await groups.save(
      groups.create({
        name: { en: 'Milk', es: 'Leche' },
        slug: 'milk',
        referenceUnit: UnitOfMeasure.LITER,
        synonyms: { en: ['milk'], es: ['leche'] },
      })
    );

    const block = await dashboard.dashboard(REQUEST);

    expect(block.supermarkets).toBe(2);
    expect(block.locations).toBe(3);
    expect(block.items).toBe(2);
    expect(block.productGroups).toBe(1);
  });

  it('splits the per scope rows by what a shopper would see', async () => {
    const priced = await newItem();
    const stale = await newItem();
    const gone = await newItem();
    // `priced` reads the materialized column rather than counting `item_prices`:
    // which source wins is decided on every read and written back onto this row,
    // so this column is the answer and the price table is the evidence.
    await supermarketItems.save([
      supermarketItems.create({
        itemId: priced.id,
        priceScopeId: scope.id,
        price: 1.19,
        currency: 'EUR',
        priceSourceKind: PriceSourceKind.OFFICIAL_API,
        priceObservedAt: at(MIDDLE_DAY),
        available: true,
        stale: false,
      }),
      supermarketItems.create({
        itemId: stale.id,
        priceScopeId: scope.id,
        price: 0.99,
        currency: 'EUR',
        priceSourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        priceObservedAt: at(WINDOW.from),
        available: true,
        stale: true,
      }),
      supermarketItems.create({
        itemId: gone.id,
        priceScopeId: scope.id,
        price: null,
        currency: null,
        priceSourceKind: null,
        priceObservedAt: null,
        available: false,
        stale: false,
      }),
    ]);

    const block = await dashboard.dashboard(REQUEST);

    expect(block.supermarketItems).toEqual({
      total: 3,
      priced: 2,
      stale: 1,
      unavailable: 1,
    });
  });

  it('answers a full window for every source kind from a table holding two rows', async () => {
    await newPrice(WINDOW.from, PriceSourceKind.OFFICIAL_API);
    await newPrice(WINDOW.to, PriceSourceKind.OFFICIAL_API);

    const block = await dashboard.dashboard(REQUEST);

    // Every kind, in enum order, even the five that have never written a price.
    // Admin plan 0015 assigns chart colours by position, so a series that
    // appeared only once it had data would take a different colour each month.
    expect(block.pricesWritten.map((series) => series.sourceKind)).toEqual(
      Object.values(PriceSourceKind)
    );
    for (const series of block.pricesWritten) {
      expectSeries(
        series.points,
        series.sourceKind === PriceSourceKind.OFFICIAL_API
          ? { [WINDOW.from]: 1, [WINDOW.to]: 1 }
          : {}
      );
    }
  });

  it('keeps two kinds written on one day in their own series', async () => {
    await newPrice(MIDDLE_DAY, PriceSourceKind.OFFICIAL_API);
    await newPrice(MIDDLE_DAY, PriceSourceKind.OFFICIAL_API, await newItem());
    await newPrice(MIDDLE_DAY, PriceSourceKind.ADMIN);
    // Before the first day of the window, so the axis the gateway named is what
    // bounds the chart rather than everything the table holds.
    await newPrice(shiftDay(WINDOW.from, -1), PriceSourceKind.ADMIN);

    const block = await dashboard.dashboard(REQUEST);

    const byKind = new Map(
      block.pricesWritten.map((series) => [series.sourceKind, series.points])
    );
    expectSeries(byKind.get(PriceSourceKind.OFFICIAL_API) ?? [], {
      [MIDDLE_DAY]: 2,
    });
    expectSeries(byKind.get(PriceSourceKind.ADMIN) ?? [], { [MIDDLE_DAY]: 1 });
  });

  it('answers the newest rows of its own trail as the activity feed', async () => {
    const created = await audit.write(
      { kind: 'admin', actorId: OPERATOR },
      (tx) =>
        tx.create(
          Item,
          items.create({
            name: { en: 'Butter', es: 'Mantequilla' },
            category: ItemCategory.DAIRY,
            defaultUnit: UnitOfMeasure.GRAM,
          })
        )
    );

    const block = await dashboard.dashboard(REQUEST);

    expect(block.activity).toHaveLength(1);
    expect(block.activity[0]).toMatchObject({
      actorId: OPERATOR,
      actorKind: 'ADMIN',
      entity: 'items',
      entityId: created.id,
      action: 'CREATE',
    });
    // The changed fields stay in the table. A feed of twenty of them is a
    // screen nobody asked for.
    expect(block.activity[0]).not.toHaveProperty('after');
  });
});
