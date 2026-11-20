import {
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES } from '../entities';
import {
  readRows,
  runKiloPieces,
  type CatalogPort,
  type HarvesterDb,
  type RowRead,
} from './kilo-pieces';

/**
 * Release task 0006 of backend plan 0244, section 7, against real Postgres.
 *
 * The unit spec answers the selection with canned rows, so only this file
 * proves the SQL: the count of rows on a product over every chain, the
 * `LEFT JOIN supermarket_sources`, the `~*` prefilter of LIDL, the latest
 * label, the price of the chain's latest run, the CTE that wraps each
 * `UPDATE ... RETURNING`, and the bind that writes `'MANUAL'` into
 * `matchedBy` and clears `"candidateEntryId"`. Catalog is an in memory fake:
 * the task never touches a catalog table.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *     --testFile=kilo-pieces.integration.spec.ts
 */

/** Chains nothing else in this database uses, so cleanup is exact. */
const MERCADONA = 'b2440000-0000-4000-a000-0000000000a1';
const LIDL = 'b2440000-0000-4000-a000-0000000000a2';
/** A third chain with no source row, which only adds to a count. */
const OTHER = 'b2440000-0000-4000-a000-0000000000a3';
const CHAINS = [MERCADONA, LIDL, OTHER];

const SCOPE_1 = 'd2440000-0000-4000-a000-0000000000b1';
const SCOPE_2 = 'd2440000-0000-4000-a000-0000000000b2';
const OLD_RUN = 'e2440000-0000-4000-a000-0000000000c1';
const NEW_RUN = 'e2440000-0000-4000-a000-0000000000c2';

const ITEM = {
  kilo: 'f2440000-0000-4000-a000-000000000001',
  ud: 'f2440000-0000-4000-a000-000000000002',
  udRead: 'f2440000-0000-4000-a000-000000000003',
  plain: 'f2440000-0000-4000-a000-000000000004',
  alas: 'f2440000-0000-4000-a000-000000000005',
  lidl: 'f2440000-0000-4000-a000-000000000006',
  shared: 'f2440000-0000-4000-a000-000000000007',
  fixed: 'f2440000-0000-4000-a000-000000000008',
  candidate: 'f2440000-0000-4000-a000-000000000009',
};

/** The time every seeded row was last written, so an untouched row says so. */
const SEEDED_AT = '2026-11-01T06:00:00.000Z';

interface Seed {
  chain: string;
  externalId: string;
  itemId: string;
  status?: 'ACTIVE' | 'CANDIDATE';
  soldByWeight?: boolean;
  sizeFormat?: string;
  unitSize?: number | null;
  sizeUnit?: string | null;
  approxWeight?: number | null;
}

interface PriceSeed {
  externalId: string;
  chain?: string;
  scope: string;
  run: string;
  price: number;
  label: string;
  observedAt: string;
}

describeIntegration('release task 0006, kilo pieces (real Postgres)', () => {
  let dataSource: DataSource;
  let db: HarvesterDb;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    db = {
      query: async <T>(sql: string, params?: unknown[]) =>
        (await dataSource.query(sql, params)) as T[],
    };
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await clean();
    await seed();
  });

  async function clean() {
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = ANY($1)`,
      [CHAINS]
    );
    await dataSource.query(
      `DELETE FROM "supermarket_sources" WHERE "supermarketId" = ANY($1)`,
      [CHAINS]
    );
  }

  async function entry(row: Seed): Promise<void> {
    await dataSource.query(
      `INSERT INTO "source_catalog_entries"
         ("supermarketId", "externalId", "sourceKind", "name", "itemId",
          "status", "soldByWeight", "sizeFormat", "unitSize", "sizeUnit",
          "approxWeight", "candidateEntryId", "matchedBy", "confidence",
          "createdAt", "updatedAt")
       VALUES ($1, $2, 'OFFICIAL_API', $3, $4, $5, $6, $7, $8, $9, $10, $11,
               'EAN', 1, $12, $12)`,
      [
        row.chain,
        row.externalId,
        `Producto ${row.externalId}`,
        row.itemId,
        row.status ?? 'ACTIVE',
        row.soldByWeight ?? false,
        row.sizeFormat ?? 'kg',
        row.unitSize ?? null,
        row.sizeUnit ?? null,
        row.approxWeight ?? null,
        null,
        SEEDED_AT,
      ]
    );
  }

  async function price(p: PriceSeed): Promise<void> {
    await dataSource.query(
      `INSERT INTO "source_entry_prices"
         ("entryId", "priceScopeId", "sourceKind", "price", "unitPrice",
          "unitPriceLabel", "observedAt", "runId")
       SELECT e.id, $3, 'OFFICIAL_API', $4, $4, $5, $6, $7
         FROM "source_catalog_entries" e
        WHERE e."supermarketId" = $1 AND e."externalId" = $2`,
      [
        p.chain ?? MERCADONA,
        p.externalId,
        p.scope,
        p.price,
        p.label,
        p.observedAt,
        p.run,
      ]
    );
  }

  async function seed(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey")
       VALUES ($1, 'mercadona-api'), ($2, 'lidl-api')`,
      [MERCADONA, LIDL]
    );
    const mercadona = (over: Omit<Seed, 'chain'>): Seed => ({
      chain: MERCADONA,
      ...over,
    });
    // 7.1: sold by weight, its latest label `kg` though an older one says `ud`.
    await entry(
      mercadona({ externalId: '50985', itemId: ITEM.kilo, soldByWeight: true })
    );
    // 7.2 before the new adapter read it.
    await entry(
      mercadona({ externalId: '60226', itemId: ITEM.ud, soldByWeight: true })
    );
    // 7.2 after the new adapter read it: off weight, a weight and no size.
    await entry(
      mercadona({ externalId: '54105', itemId: ITEM.udRead, approxWeight: 350 })
    );
    // A plain pack, which the selection never reads.
    await entry(mercadona({ externalId: '11111', itemId: ITEM.plain }));
    // 7.4: the live piece and the one that answers 404.
    await entry(
      mercadona({ externalId: '2785', itemId: ITEM.alas, soldByWeight: true })
    );
    await entry(
      mercadona({ externalId: '4195', itemId: ITEM.alas, soldByWeight: true })
    );
    // A proposal left on the row, which the bind clears.
    await dataSource.query(
      `UPDATE "source_catalog_entries" e
          SET "candidateEntryId" = s.id
         FROM "source_catalog_entries" s
        WHERE e."supermarketId" = $1 AND e."externalId" = '4195'
          AND s."supermarketId" = $1 AND s."externalId" = '11111'`,
      [MERCADONA]
    );
    // Not ACTIVE, so in no group.
    await entry(
      mercadona({
        externalId: '99999',
        itemId: ITEM.candidate,
        status: 'CANDIDATE',
        soldByWeight: true,
      })
    );

    const lidl = (over: Omit<Seed, 'chain'>): Seed => ({
      chain: LIDL,
      sizeFormat: 'Aprox. 350 g',
      unitSize: 350,
      sizeUnit: 'GRAM',
      ...over,
    });
    await entry(lidl({ externalId: 'lidl-1', itemId: ITEM.lidl }));
    // Shares its product with a row of a chain that has no source row.
    await entry(lidl({ externalId: 'lidl-2', itemId: ITEM.shared }));
    await entry({
      chain: OTHER,
      externalId: 'other-1',
      itemId: ITEM.shared,
      sizeFormat: '350 g',
      unitSize: 350,
      sizeUnit: 'GRAM',
    });
    // A fixed size, which the prefilter drops.
    await entry(
      lidl({ externalId: 'lidl-3', itemId: ITEM.fixed, sizeFormat: '500 g' })
    );

    const newer = '2026-11-04T06:00:00.000Z';
    const older = '2026-10-20T06:00:00.000Z';
    // Scope 1: the newest price row of the chain names NEW_RUN.
    await price({
      externalId: '50985',
      scope: SCOPE_1,
      run: NEW_RUN,
      price: 13.42,
      label: 'kg',
      observedAt: newer,
    });
    await price({
      externalId: '50985',
      scope: SCOPE_2,
      run: OLD_RUN,
      price: 13.1,
      label: 'ud',
      observedAt: older,
    });
    await price({
      externalId: '60226',
      scope: SCOPE_1,
      run: NEW_RUN,
      price: 6.5,
      label: 'ud',
      observedAt: newer,
    });
    await price({
      externalId: '54105',
      scope: SCOPE_1,
      run: NEW_RUN,
      price: 3.05,
      label: 'ud',
      observedAt: newer,
    });
    await price({
      externalId: '2785',
      scope: SCOPE_1,
      run: NEW_RUN,
      price: 5.2,
      label: 'kg',
      observedAt: newer,
    });
    // The dead row keeps a stale and lower price from the run before.
    await price({
      externalId: '4195',
      scope: SCOPE_1,
      run: OLD_RUN,
      price: 5.1,
      label: 'kg',
      observedAt: older,
    });
  }

  const ours = (rows: RowRead[]) =>
    new Map(
      rows
        .filter((row) => CHAINS.includes(row.supermarketId))
        .map((row) => [row.externalId, row])
    );

  it('selects each group of section 7, with its latest label and its price of the latest run', async () => {
    const rows = ours(await readRows(db));

    expect([...rows.keys()].sort()).toEqual(
      ['2785', '4195', '50985', '54105', '60226', 'lidl-1', 'lidl-2'].sort()
    );
    expect(rows.get('50985')).toMatchObject({
      adapterKey: 'mercadona-api',
      soldByWeight: true,
      label: 'kg',
      latestRunPrice: 13.1,
      rowsOnItem: 1,
    });
    expect(rows.get('54105')).toMatchObject({
      soldByWeight: false,
      label: 'ud',
      unitSize: null,
    });
    expect(rows.get('2785')).toMatchObject({
      latestRunPrice: 5.2,
      rowsOnItem: 2,
    });
    // Its stale 5.10 names a run older than the chain's latest at scope 1.
    expect(rows.get('4195')?.latestRunPrice).toBeNull();
    expect(rows.get('lidl-1')).toMatchObject({
      adapterKey: 'lidl-api',
      unitSize: 350,
      rowsOnItem: 1,
      label: null,
    });
    // Counted over every chain, the one with no source row included.
    expect(rows.get('lidl-2')?.rowsOnItem).toBe(2);
  });

  it('finishes the rows of 7.2, moves the dead row of 7.4, and keeps the live one', async () => {
    const items = new Map<string, ItemView>(
      [
        view(ITEM.kilo, UnitOfMeasure.GRAM, 1560),
        view(ITEM.ud, UnitOfMeasure.GRAM, 580),
        view(ITEM.udRead, UnitOfMeasure.GRAM, 350),
        view(ITEM.alas, UnitOfMeasure.KILOGRAM, null),
        view(ITEM.lidl, UnitOfMeasure.GRAM, 350),
        view(ITEM.shared, UnitOfMeasure.GRAM, 350),
      ].map((i) => [i.id, i])
    );
    const created: string[] = [];
    const catalog: CatalogPort = {
      getMany: async (ids) =>
        ids.flatMap((id) => (items.has(id) ? [items.get(id) as ItemView] : [])),
      update: async (input) => ({
        ...(items.get(input.itemId) as ItemView),
        defaultUnit: input.defaultUnit as UnitOfMeasure,
        unitSize: null,
        approxWeight: input.approxWeight ?? null,
        approxWeightSetBy: 'SOURCE',
      }),
      create: async () => {
        const made = view(randomUUID(), UnitOfMeasure.KILOGRAM, null);
        created.push(made.id);
        return made;
      },
      findCreatedFromEntry: async () => null,
      findItemByEan: async () => null,
      linkImages: async () => ({
        linked: 0,
        moved: 0,
        unchanged: 0,
        rejected: [],
      }),
    };
    const lines: string[] = [];

    const failures = await runKiloPieces(
      { harvester: db, catalog, log: (line) => lines.push(line) },
      { mode: 'write', maxKilo: 1000, maxPiece: 1000, maxSplit: 1000 }
    );

    expect(failures).toBe(0);
    expect(created).toHaveLength(1);
    const after = await stored();
    // 7.2, Mercadona, before the adapter: off weight and written now.
    expect(after.get('60226')).toMatchObject({ soldByWeight: false });
    expect(after.get('60226')?.updatedAt.toISOString()).not.toBe(SEEDED_AT);
    // 7.2, Mercadona, after the adapter: matched, and left exactly as it was.
    expect(after.get('54105')).toMatchObject({ soldByWeight: false });
    expect(after.get('54105')?.updatedAt.toISOString()).toBe(SEEDED_AT);
    // 7.2, LIDL: the weight and no size.
    expect(after.get('lidl-1')).toMatchObject({
      unitSize: null,
      sizeUnit: null,
      approxWeight: '350.0000',
    });
    // Not its product's only row, so left as it was.
    expect(after.get('lidl-2')).toMatchObject({ unitSize: '350.0000' });
    // 7.4: the live row keeps the product, the dead row moves.
    expect(after.get('2785')).toMatchObject({ itemId: ITEM.alas });
    expect(after.get('4195')).toMatchObject({
      itemId: created[0],
      matchedBy: 'MANUAL',
      candidateEntryId: null,
      confidence: '1.000',
    });
    expect(lines).toContain('failures 0');
  });

  async function stored() {
    const rows = (await dataSource.query(
      `SELECT "externalId", "itemId", "soldByWeight", "unitSize", "sizeUnit",
              "approxWeight", "matchedBy", "candidateEntryId", "confidence",
              "updatedAt"
         FROM "source_catalog_entries"
        WHERE "supermarketId" = ANY($1)`,
      [CHAINS]
    )) as {
      externalId: string;
      itemId: string;
      soldByWeight: boolean;
      unitSize: string | null;
      sizeUnit: string | null;
      approxWeight: string | null;
      matchedBy: string | null;
      candidateEntryId: string | null;
      confidence: string;
      updatedAt: Date;
    }[];
    return new Map(rows.map((row) => [row.externalId, row]));
  }
});

function view(
  id: string,
  defaultUnit: UnitOfMeasure,
  unitSize: number | null
): ItemView {
  return {
    id,
    name: { es: `Producto ${id}` },
    brand: 'Hacendado',
    imageUrl: null,
    imageSource: null,
    imageSupermarketId: null,
    ownImageUrl: null,
    images: [],
    sku: null,
    ean: null,
    eans: [],
    unitSize,
    approxWeight: null,
    approxWeightSetBy: null,
    packCount: null,
    categories: [],
    defaultUnit,
    productGroupId: null,
  } as unknown as ItemView;
}
