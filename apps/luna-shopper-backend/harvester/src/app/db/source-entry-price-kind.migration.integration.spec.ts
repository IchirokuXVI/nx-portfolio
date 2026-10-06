import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { SourceEntryPriceKind1759200000000 } from './migrations/1759200000000-SourceEntryPriceKind';

/**
 * The kind on a price row, and what the migration must not move (plan 0190).
 *
 * The migration runs on the one curated catalog, so the claims are about the
 * rows that exist before it, and none can be made without a real database:
 *
 * - **No price changes and no row goes.** Every column that existed before
 *   reads the same after, for every row.
 * - **A price takes the kind of its run**: the stamp of a file import, the
 *   adapter of a walk. A leaflet price on a row that says website becomes a
 *   leaflet price, which is the eight rows of the first catalog.
 * - **A price whose kind cannot be read stays null**, and is not given the
 *   kind of its row: no run, a run that is gone, a file import that names no
 *   official kind, a walk of a chain with no source row.
 * - **The key holds the kind**, so two kinds share a scope and one kind does
 *   not, a null kind included.
 * - **The down refuses to delete.**
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state *before* the
 * migration, which cannot be reached on a database that already has it.
 *
 * **Every read and write here is SQL, and none goes through an entity.** The
 * probe stops at this migration, and an entity describes the newest schema.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=source-entry-price-kind.migration.integration.spec.ts
 */

/**
 * The list up to and including the one under test, and everything before it.
 * A prefix rather than a filter, so a migration added after this one never
 * runs against the old schema here.
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SourceEntryPriceKind1759200000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0190_probe';

/** A chain whose adapter walks a website, one whose adapter is an API, one with no source row. */
const DEZA = '01900190-0000-4000-a000-00000000000a';
const MERCADONA = '01900190-0000-4000-a000-00000000000b';
const NO_SOURCE = '01900190-0000-4000-a000-00000000000c';
/** An adapter the frozen list does not name. A walk of it is a website walk. */
const ELJAMON = '01900190-0000-4000-a000-00000000000d';

const SCOPE = '01900190-0000-4000-a000-0000000000f1';
const OTHER_SCOPE = '01900190-0000-4000-a000-0000000000f2';

const WEB_WALK = '01900190-0000-4000-a000-0000000000a1';
const API_WALK = '01900190-0000-4000-a000-0000000000a2';
const LEAFLET_IMPORT = '01900190-0000-4000-a000-0000000000a3';
const WEB_IMPORT = '01900190-0000-4000-a000-0000000000a4';
/** A file import from before the upload asked for a kind. */
const SILENT_IMPORT = '01900190-0000-4000-a000-0000000000a5';
/** A file import whose input names a kind no run stamps. */
const ADMIN_IMPORT = '01900190-0000-4000-a000-0000000000a6';
const UNSOURCED_WALK = '01900190-0000-4000-a000-0000000000a7';
const ELJAMON_WALK = '01900190-0000-4000-a000-0000000000a8';
/** A run id no row of `harvest_runs` carries. */
const GONE_RUN = '01900190-0000-4000-a000-0000000000a9';

interface Seed {
  /** The name of the case, and the `externalId` of its row. */
  key: string;
  chain: string;
  /** What the row says, which is never what the price is given. */
  entryKind: string;
  runId: string | null;
  price: number;
  /** The kind the migration must give the price, or null for none. */
  expected: string | null;
  scope?: string;
}

const SEED: Seed[] = [
  {
    // The eight rows of the first catalog: a leaflet wrote the price, and a
    // website walk rewrote the kind of the row since.
    key: 'leaflet-price-on-a-website-row',
    chain: DEZA,
    entryKind: 'OFFICIAL_WEB',
    runId: LEAFLET_IMPORT,
    price: 1.15,
    expected: 'OFFICIAL_LEAFLET',
  },
  {
    key: 'leaflet-price-on-a-leaflet-row',
    chain: DEZA,
    entryKind: 'OFFICIAL_LEAFLET',
    runId: LEAFLET_IMPORT,
    price: 3.4,
    expected: 'OFFICIAL_LEAFLET',
  },
  {
    key: 'website-price',
    chain: DEZA,
    entryKind: 'OFFICIAL_WEB',
    runId: WEB_WALK,
    price: 2.45,
    expected: 'OFFICIAL_WEB',
  },
  {
    // The other direction: a walk wrote the price, and a leaflet rewrote
    // the kind of the row since.
    key: 'website-price-on-a-leaflet-row',
    chain: DEZA,
    entryKind: 'OFFICIAL_LEAFLET',
    runId: WEB_WALK,
    price: 2.5,
    expected: 'OFFICIAL_WEB',
  },
  {
    key: 'api-price',
    chain: MERCADONA,
    entryKind: 'OFFICIAL_API',
    runId: API_WALK,
    price: 0.92,
    expected: 'OFFICIAL_API',
  },
  {
    key: 'walk-of-an-adapter-the-list-does-not-name',
    chain: ELJAMON,
    entryKind: 'OFFICIAL_WEB',
    runId: ELJAMON_WALK,
    price: 2.95,
    expected: 'OFFICIAL_WEB',
  },
  {
    // An export of the website, uploaded as a file: the stamp wins over the
    // mode.
    key: 'file-import-stamped-website',
    chain: DEZA,
    entryKind: 'OFFICIAL_LEAFLET',
    runId: WEB_IMPORT,
    price: 4.1,
    expected: 'OFFICIAL_WEB',
  },
  {
    key: 'no-run',
    chain: DEZA,
    entryKind: 'OFFICIAL_LEAFLET',
    runId: null,
    price: 5.5,
    expected: null,
  },
  {
    key: 'run-gone',
    chain: DEZA,
    entryKind: 'OFFICIAL_WEB',
    runId: GONE_RUN,
    price: 1.35,
    expected: null,
  },
  {
    key: 'file-import-with-no-kind',
    chain: DEZA,
    entryKind: 'OFFICIAL_LEAFLET',
    runId: SILENT_IMPORT,
    price: 1.05,
    expected: null,
  },
  {
    key: 'file-import-with-a-kind-no-run-stamps',
    chain: DEZA,
    entryKind: 'OFFICIAL_LEAFLET',
    runId: ADMIN_IMPORT,
    price: 1.0,
    expected: null,
  },
  {
    key: 'walk-of-a-chain-with-no-source-row',
    chain: NO_SOURCE,
    entryKind: 'OFFICIAL_WEB',
    runId: UNSOURCED_WALK,
    price: 7.2,
    expected: null,
  },
];

interface PriceRow {
  key: string;
  /** Every column the table had before the migration, as one text. */
  held: string;
  sourceKind: string | null;
}

describeIntegration('SourceEntryPriceKind1759200000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;
  let before: PriceRow[];
  let entriesBefore: string;
  let log: string[];

  /**
   * Each price beside its case. `held` is every column that existed before
   * the migration, read through `to_jsonb` minus the new one, so the same
   * statement answers on both sides of it.
   */
  const read = (dataSource: DataSource): Promise<PriceRow[]> =>
    dataSource.query(
      `SELECT e."externalId" AS "key",
                (to_jsonb(p) - 'sourceKind')::text AS "held",
                to_jsonb(p) ->> 'sourceKind' AS "sourceKind"
           FROM "source_entry_prices" p
           JOIN "source_catalog_entries" e ON e."id" = p."entryId"
          ORDER BY e."externalId", p."priceScopeId", p."id"`
    );

  const readEntries = async (dataSource: DataSource): Promise<string> =>
    (
      await dataSource.query(
        `SELECT md5(string_agg(to_jsonb(e)::text, '' ORDER BY e."id")) AS "all"
             FROM "source_catalog_entries" e`
      )
    )[0].all;

  const connect = async (
    migrations: typeof HARVESTER_MIGRATIONS
  ): Promise<DataSource> => {
    const dataSource = new DataSource({
      type: 'postgres',
      url: probeUrl,
      migrations,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await dataSource.initialize();
    return dataSource;
  };

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing that makes the next one
    // fail on a database that already exists.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

    url.pathname = `/${PROBE_DATABASE}`;
    probeUrl = url.toString();

    probe = await connect(BEFORE);
    await probe.runMigrations({ transaction: 'each' });

    await probe.query(
      `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey")
         VALUES ($1, 'deza-web'), ($2, 'mercadona-api'), ($3, 'eljamon-web')`,
      [DEZA, MERCADONA, ELJAMON]
    );
    // Finished, because a chain holds one run at a time that is not.
    await probe.query(
      `INSERT INTO "harvest_runs"
                ("id", "supermarketId", "mode", "status", "input")
         VALUES ($1, $9, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
                ($2, $10, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
                ($3, $9, 'FILE_IMPORT', 'COMPLETED',
                 '{"sourceKind":"OFFICIAL_LEAFLET"}'::jsonb),
                ($4, $9, 'FILE_IMPORT', 'COMPLETED',
                 '{"sourceKind":"OFFICIAL_WEB"}'::jsonb),
                ($5, $9, 'FILE_IMPORT', 'COMPLETED', '{}'::jsonb),
                ($6, $9, 'FILE_IMPORT', 'COMPLETED',
                 '{"sourceKind":"ADMIN"}'::jsonb),
                ($7, $11, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
                ($8, $12, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb)`,
      [
        WEB_WALK,
        API_WALK,
        LEAFLET_IMPORT,
        WEB_IMPORT,
        SILENT_IMPORT,
        ADMIN_IMPORT,
        UNSOURCED_WALK,
        ELJAMON_WALK,
        DEZA,
        MERCADONA,
        NO_SOURCE,
        ELJAMON,
      ]
    );
    for (const seed of SEED) {
      const [entry] = await probe.query(
        `INSERT INTO "source_catalog_entries"
                  ("supermarketId", "externalId", "sourceKind", "name",
                   "status")
           VALUES ($1, $2, $3, $4, 'UNRESOLVED')
           RETURNING "id"`,
        [seed.chain, seed.key, seed.entryKind, `Producto ${seed.key}`]
      );
      await probe.query(
        `INSERT INTO "source_entry_prices"
                  ("entryId", "priceScopeId", "price", "currency",
                   "unitPrice", "unitPriceLabel", "validUntil", "details",
                   "observedAt", "runId")
           VALUES ($1, $2, $3, 'EUR', $4, 'kg', $5, $6,
                   '2026-10-03T16:12:00.000Z', $7)`,
        [
          entry.id,
          seed.scope ?? SCOPE,
          seed.price,
          seed.price * 2,
          '2026-10-08T22:00:00.000Z',
          JSON.stringify({ page: 4, raw: seed.key }),
          seed.runId,
        ]
      );
    }
    before = await read(probe);
    entriesBefore = await readEntries(probe);

    // The migration itself, as its own data source, so the migrations table
    // carries exactly the state a real deployment's does when this one runs.
    await probe.destroy();
    probe = await connect(THROUGH);
    log = [];
    const spy = jest
      .spyOn(console, 'log')
      .mockImplementation((line: string) => {
        log.push(String(line));
      });
    try {
      await probe.runMigrations({ transaction: 'each' });
    } finally {
      spy.mockRestore();
    }
  }, 180_000);

  afterAll(async () => {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  });

  it('is newer than every migration before it', () => {
    const stamps = BEFORE.map((migration) =>
      Number(/(\d{13})$/.exec(migration.name)?.[1])
    );
    expect(stamps.length).toBeGreaterThan(0);
    expect(Math.max(...stamps)).toBeLessThan(1759200000000);
  });

  it('changes no price and deletes no row', async () => {
    const after = await read(probe);

    expect(before).toHaveLength(SEED.length);
    // Before the migration the column does not exist, so the key is absent.
    expect(before.every((row) => row.sourceKind === null)).toBe(true);
    expect(after.map(({ key, held }) => [key, held])).toEqual(
      before.map(({ key, held }) => [key, held])
    );
  }, 180_000);

  it('changes no source row, the kind of a row included', async () => {
    expect(await readEntries(probe)).toBe(entriesBefore);
  }, 180_000);

  it('gives each price the kind of its run, and none where the run does not say', async () => {
    const after = await read(probe);

    expect(
      Object.fromEntries(after.map((row) => [row.key, row.sourceKind]))
    ).toEqual(
      Object.fromEntries(SEED.map((seed) => [seed.key, seed.expected]))
    );
  }, 180_000);

  it('never takes the kind of the row for a price it cannot read', async () => {
    // Each of these rows says a kind. None of it reached the price.
    const unread = SEED.filter((seed) => seed.expected === null);
    expect(unread.map((seed) => seed.entryKind).sort()).toEqual([
      'OFFICIAL_LEAFLET',
      'OFFICIAL_LEAFLET',
      'OFFICIAL_LEAFLET',
      'OFFICIAL_WEB',
      'OFFICIAL_WEB',
    ]);
    const after = await read(probe);
    for (const seed of unread) {
      expect(after.find((row) => row.key === seed.key)?.sourceKind).toBeNull();
    }
  }, 180_000);

  it('states in its log what it stamped and what it left, by reason', () => {
    const line = log.find((each) =>
      each.startsWith('SourceEntryPriceKind1759200000000')
    );

    expect(line).toContain(
      'stamped 1 OFFICIAL_API, 2 OFFICIAL_LEAFLET, 4 OFFICIAL_WEB'
    );
    expect(line).toContain('1 that name no run');
    expect(line).toContain('1 whose run is gone');
    expect(line).toContain('3 whose run does not say');
  });

  it('lets a second kind share a scope, and refuses a second price of one kind', async () => {
    const [{ id: entryId }] = await probe.query(
      `SELECT "id" FROM "source_catalog_entries" WHERE "externalId" = $1`,
      ['website-price']
    );
    const insert = (sourceKind: string | null, scope = SCOPE) =>
      probe.query(
        `INSERT INTO "source_entry_prices"
                  ("entryId", "priceScopeId", "price", "sourceKind")
           VALUES ($1, $2, 1.99, $3)`,
        [entryId, scope, sourceKind]
      );

    // The row holds a website price at the scope. A leaflet price joins it.
    await insert('OFFICIAL_LEAFLET');
    await expect(insert('OFFICIAL_WEB')).rejects.toThrow(
      /uq_source_entry_prices_scope_kind/
    );
    await expect(insert('OFFICIAL_LEAFLET')).rejects.toThrow(
      /uq_source_entry_prices_scope_kind/
    );
    // A price of no kind is one per scope too, as before the plan.
    await insert(null, OTHER_SCOPE);
    await expect(insert(null, OTHER_SCOPE)).rejects.toThrow(
      /uq_source_entry_prices_scope_kind/
    );
  }, 180_000);

  it('refuses to be undone while two prices share a scope, and deletes nothing', async () => {
    // The test above left a website price and a leaflet price at one scope.
    const held = await read(probe);

    await expect(
      probe.undoLastMigration({ transaction: 'each' })
    ).rejects.toThrow(/cannot be undone: 1 row\(s\) hold two prices/);

    expect(await read(probe)).toEqual(held);
  }, 180_000);

  it('is undone, and applied again with the same answer, once no two prices share a scope', async () => {
    // A person decided which of the two stays. Here: the test's own row.
    await probe.query(`DELETE FROM "source_entry_prices" WHERE "price" = 1.99`);

    await probe.undoLastMigration({ transaction: 'each' });
    const down = await read(probe);
    expect(down.every((row) => row.sourceKind === null)).toBe(true);
    expect(down.map(({ key, held }) => [key, held])).toEqual(
      before.map(({ key, held }) => [key, held])
    );
    // The old key is back: one price per row and scope.
    const [{ id: entryId }] = await probe.query(
      `SELECT "id" FROM "source_catalog_entries" WHERE "externalId" = $1`,
      ['website-price']
    );
    await expect(
      probe.query(
        `INSERT INTO "source_entry_prices"
                  ("entryId", "priceScopeId", "price")
           VALUES ($1, $2, 1.99)`,
        [entryId, SCOPE]
      )
    ).rejects.toThrow(/uq_source_entry_prices_scope/);

    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await probe.runMigrations({ transaction: 'each' });
    } finally {
      spy.mockRestore();
    }
    const again = await read(probe);
    expect(
      Object.fromEntries(again.map((row) => [row.key, row.sourceKind]))
    ).toEqual(
      Object.fromEntries(SEED.map((seed) => [seed.key, seed.expected]))
    );
  }, 180_000);
});
