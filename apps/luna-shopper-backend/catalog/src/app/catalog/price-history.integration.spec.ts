import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type ItemPricePointView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  Item,
  ItemPrice,
  PricePolicy,
  PriceScope,
  Supermarket,
} from '../entities';
import { PriceHistoryService } from './price-history.service';

/**
 * The price history a shopper can read, against real Postgres (plan 0196,
 * section 2).
 *
 * The replay itself is proven by `price-history.spec.ts` with no database.
 * What a fake cannot prove is here: that the statement loads the rows of the
 * whole stack of each scope, old ones included, that the stack is the one
 * `lessSpecificScopesOf` answers, that the seeded policies are the ones read,
 * and that a `numeric` printed as text comes out as a number.
 *
 * The rows are those of two scopes of one chain, its national scope and one
 * region, written straight into `item_prices`. The price writer refuses a
 * date far in the past, and a history is made of exactly those.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=price-history
 */
const SCHEMA = 'plan0196_price_history_test';
const SHOPPER = 'shopper';
const RUN = '33333333-3333-4333-8333-333333333196';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 5, 1, 12, 0, 0);

/** Day N of the fixture, at noon. Every read here starts at day 0. */
function day(n: number): Date {
  return new Date(BASE + n * DAY_MS);
}

describeIntegration('the price history of a product (real Postgres)', () => {
  let dataSource: DataSource;
  let history: PriceHistoryService;

  const ids = {
    chain: '',
    national: '',
    region: '',
    otherChain: '',
    otherScope: '',
    milk: '',
    bread: '',
  };

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
      // `public` behind the scratch schema for the extensions the migrations
      // use, as in the search integration spec.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    history = new PriceHistoryService(
      dataSource.getRepository(ItemPrice),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(PricePolicy)
    );

    const chains = dataSource.getRepository(Supermarket);
    const chain = async (name: string) =>
      (await chains.save(chains.create({ name: { en: name, es: name } }))).id;
    ids.chain = await chain('Chain');
    ids.otherChain = await chain('Other chain');

    // Through `create` and `save`, so each scope takes the priority of its
    // kind: the region is more specific than the national scope.
    const scopes = dataSource.getRepository(PriceScope);
    const scope = async (
      supermarketId: string,
      kind: PriceScopeKind,
      externalKey: string | null
    ) =>
      (
        await scopes.save(
          scopes.create({ supermarketId, kind, externalKey, label: null })
        )
      ).id;
    ids.national = await scope(ids.chain, PriceScopeKind.NATIONAL, null);
    ids.region = await scope(ids.chain, PriceScopeKind.REGION, '4661');
    ids.otherScope = await scope(ids.otherChain, PriceScopeKind.NATIONAL, null);

    const items = dataSource.getRepository(Item);
    const item = async (name: string) =>
      (
        await items.save(
          items.create({
            name: { en: name, es: name },
            defaultUnit: UnitOfMeasure.LITER,
          })
        )
      ).id;
    ids.milk = await item('Milk');
    ids.bread = await item('Bread');

    const prices = dataSource.getRepository(ItemPrice);
    const row = (values: Partial<ItemPrice> & { observedAt: Date }) =>
      prices.create({
        itemId: ids.milk,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        currency: 'EUR',
        unitPrice: null,
        unitPriceLabel: null,
        lastObservedAt: values.observedAt,
        validFrom: null,
        validUntil: null,
        sourceRunId: RUN,
        lastObservedRunId: RUN,
        copiedFromScopeId: null,
        overrides: null,
        protectedUntil: null,
        ...values,
      });
    await prices.save([
      // The national price, stated before the range and seen all through.
      // An old row: only a statement with no lower bound on `observedAt`
      // finds it.
      row({
        priceScopeId: ids.national,
        price: 2,
        unitPrice: 4,
        unitPriceLabel: 'kg',
        observedAt: day(-200),
        lastObservedAt: day(60),
      }),
      // The region gets a price of its own on day 20.
      row({
        priceScopeId: ids.region,
        price: 1.8,
        observedAt: day(20),
        lastObservedAt: day(60),
      }),
      // A national leaflet, imported on day 28 for the week from day 30.
      row({
        priceScopeId: ids.national,
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: 1.5,
        observedAt: day(28),
        validFrom: day(30),
        validUntil: day(37),
      }),
      // Another chain, which no stack of the first one reaches.
      row({
        priceScopeId: ids.otherScope,
        price: 9.99,
        observedAt: day(-5),
        lastObservedAt: day(60),
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  const read = (
    itemId: string,
    priceScopeIds: string[],
    range: { from?: Date; to?: Date } = {}
  ) =>
    history.forItem({
      userId: SHOPPER,
      itemId,
      priceScopeIds,
      from: (range.from ?? day(0)).toISOString(),
      to: (range.to ?? day(60)).toISOString(),
    });

  /** A series as `[ISO instant, price]` pairs. */
  const steps = (points: ItemPricePointView[]): [string, number | null][] =>
    points.map((point) => [point.at, point.price]);

  it('replays the region through its own rows and the rows it falls through to', async () => {
    const view = await read(ids.milk, [ids.region]);

    expect(view).toMatchObject({
      itemId: ids.milk,
      from: day(0).toISOString(),
      to: day(60).toISOString(),
    });
    expect(view.series).toHaveLength(1);
    expect(view.series[0]).toMatchObject({
      priceScopeId: ids.region,
      supermarketId: ids.chain,
    });
    // The national price until the region has its own. Then the leaflet for
    // its week, because a leaflet outranks a crawl at any scope of the stack,
    // and the region's own price again after it.
    expect(steps(view.series[0].points)).toEqual([
      [day(0).toISOString(), 2],
      [day(20).toISOString(), 1.8],
      [day(30).toISOString(), 1.5],
      [day(37).toISOString(), 1.8],
    ]);
  });

  it('answers each point whole, with numbers and the basis of the unit price', async () => {
    const view = await read(ids.milk, [ids.region]);

    expect(view.series[0].points[0]).toEqual({
      at: day(0).toISOString(),
      price: 2,
      currency: 'EUR',
      unitPrice: 4,
      unitPriceLabel: 'kg',
      unitBasis: 'KILOGRAM',
    });
    // The region's own row states no unit price, and none is carried over.
    expect(view.series[0].points[1]).toMatchObject({
      price: 1.8,
      unitPrice: null,
      unitPriceLabel: null,
      unitBasis: null,
    });
  });

  it('never reads the national scope through a narrower one', async () => {
    const view = await read(ids.milk, [ids.national]);

    // The region's price is not a price of the national scope.
    expect(steps(view.series[0].points)).toEqual([
      [day(0).toISOString(), 2],
      [day(30).toISOString(), 1.5],
      [day(37).toISOString(), 2],
    ]);
  });

  it('answers one series for each scope that exists, in the order asked', async () => {
    const view = await read(ids.milk, [
      ids.otherScope,
      ids.region,
      // An id that names no scope, an id that is no uuid, and a repeat.
      randomUUID(),
      'not-a-uuid',
      ids.national,
      ids.region,
    ]);

    expect(view.series.map((series) => series.priceScopeId)).toEqual([
      ids.otherScope,
      ids.region,
      ids.national,
    ]);
    // Each series keeps to its own chain.
    expect(view.series[0].supermarketId).toBe(ids.otherChain);
    expect(steps(view.series[0].points)).toEqual([
      [day(0).toISOString(), 9.99],
    ]);
    expect(view.series[1].points).toHaveLength(4);
  });

  it('answers one null point for a scope with no row for the product', async () => {
    const view = await read(ids.bread, [ids.region]);

    expect(view.series[0].points).toEqual([
      {
        at: day(0).toISOString(),
        price: null,
        currency: null,
        unitPrice: null,
        unitPriceLabel: null,
        unitBasis: null,
      },
    ]);
  });

  it('reads no row that began after the end of the range', async () => {
    const view = await read(ids.milk, [ids.region], { to: day(10) });

    expect(steps(view.series[0].points)).toEqual([[day(0).toISOString(), 2]]);
  });

  it('answers an empty series list when the read has no scope', async () => {
    const view = await read(ids.milk, []);

    expect(view.series).toEqual([]);
    expect(view.from).toBe(day(0).toISOString());
  });

  it('cuts a range longer than 400 days at its start, and says so', async () => {
    const view = await read(ids.milk, [ids.national], { from: day(-1000) });

    expect(view.from).toBe(day(60 - 400).toISOString());
    // The first point is at the start that was read, 400 days before the
    // end. Nothing was stated yet on that day, so it is a null point.
    expect(view.series[0].points[0]).toMatchObject({
      at: day(60 - 400).toISOString(),
      price: null,
    });
    expect(view.series[0].points[1]).toMatchObject({
      at: day(-200).toISOString(),
      price: 2,
    });
  });

  it('refuses a start after the end', async () => {
    await expect(
      read(ids.milk, [ids.region], { from: day(61) })
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('answers not found for a product that does not exist', async () => {
    await expect(read(randomUUID(), [ids.region])).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(read('not-a-uuid', [ids.region])).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
