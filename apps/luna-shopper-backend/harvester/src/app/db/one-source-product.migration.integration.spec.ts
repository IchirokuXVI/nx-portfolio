import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES } from '../entities';
import { HARVESTER_MIGRATIONS } from './migrations';
import { OneSourceProduct1756900000000 } from './migrations/1756900000000-OneSourceProduct';

/**
 * The fold of plan 0086, section 11, row by row against real Postgres.
 *
 * **A migration that rewrites data cannot be proven any other way.** Every step
 * of it is SQL: an `ON CONFLICT` that lets an alias's decision win onto a
 * sibling row only when that row has none, a `DISTINCT ON` that keeps the later
 * of two refs, an enum rebuilt by rename and convert with a `CASE` inside the
 * `USING`, and a `LATERAL` that finds the scope a chain's prices were written
 * for. A mocked repository cannot tell you whether any of that is right, and
 * neither can reading it.
 *
 * It runs against a **database of its own**, created and dropped here, rather
 * than against the slot's. The migrations under test rewrite types and drop
 * tables, so running them over a database another suite is using would be a
 * test that breaks its neighbours, and running them over one already migrated
 * would prove nothing: the whole point is the state *before* the fold.
 *
 *   docker run -d --name tmp-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=harvester \
 *     -p 45911:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://postgres:pw@localhost:45911/harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/** Everything before the one under test, which is the state the fold starts in. */
const BEFORE = HARVESTER_MIGRATIONS.filter(
  (migration) => migration !== OneSourceProduct1756900000000
);

const PROBE_DATABASE = 'luna_harvester_0086_probe';

const MERCADONA = '5efa0086-0000-4000-a000-00000000000a';
const DEZA = '5efa0086-0000-4000-a000-00000000000b';
const NATIONAL = '5efa0086-0000-4000-a000-0000000000c1';
const RUN_WALK = '5efa0086-0000-4000-a000-0000000000d1';
const RUN_REFRESH = '5efa0086-0000-4000-a000-0000000000d2';
const RUN_LEAFLET_A = '5efa0086-0000-4000-a000-0000000000d3';
const RUN_LEAFLET_B = '5efa0086-0000-4000-a000-0000000000d4';
const ITEM_MILK = '5efa0086-0000-4000-a000-0000000000e1';
const ITEM_BEER = '5efa0086-0000-4000-a000-0000000000e2';
const ITEM_ORPHAN = '5efa0086-0000-4000-a000-0000000000e3';

interface EntryRow {
  externalId: string;
  sourceKind: string;
  name: string;
  brand: string | null;
  sizeFormat: string | null;
  itemId: string | null;
  status: string;
  matchedBy: string | null;
  confidence: string;
  decidedAt: Date | null;
  timesSeen: number;
}

/** `sha1(aliasKey)`, which is what the fold keys a moved alias on. */
function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

describeIntegration('OneSourceProduct1756900000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing that makes the next one fail
    // on a database that already exists.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

    url.pathname = `/${PROBE_DATABASE}`;
    probeUrl = url.toString();
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: HARVESTER_ENTITIES,
      migrations: BEFORE,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    await probe.runMigrations({ transaction: 'each' });
    await seed(probe);

    // The fold itself, as its own data source, so the migrations table carries
    // exactly the state a real deployment's does when this one runs.
    await probe.destroy();
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: HARVESTER_ENTITIES,
      migrations: HARVESTER_MIGRATIONS,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    await probe.runMigrations({ transaction: 'each' });
  }, 120_000);

  afterAll(async () => {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  });

  /**
   * The state before the fold: rows in all three old tables, and two leaflet
   * runs of one chain for two scopes.
   */
  async function seed(dataSource: DataSource): Promise<void> {
    await dataSource.query(
      `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey", "enabled")
       VALUES ($1, 'mercadona-api', true), ($2, 'deza-web', true)`,
      [MERCADONA, DEZA]
    );
    await dataSource.query(
      `INSERT INTO "harvest_runs" ("id", "supermarketId", "priceScopeId", "mode", "status")
       VALUES ($1, $2, $3, 'CATALOG_DISCOVERY', 'COMPLETED'),
              ($4, $2, $3, 'REFRESH', 'COMPLETED'),
              ($5, $2, $3, 'LEAFLET_IMPORT', 'COMPLETED'),
              ($6, $2, $3, 'LEAFLET_IMPORT', 'COMPLETED')`,
      [RUN_WALK, MERCADONA, NATIONAL, RUN_REFRESH, RUN_LEAFLET_A, RUN_LEAFLET_B]
    );

    // Three snapshot rows: one a ref resolves, one nothing does, and one of the
    // DEZA chain, whose adapter renders a page.
    await dataSource.query(
      `INSERT INTO "source_catalog_entries"
         ("supermarketId", "externalId", "name", "brand", "sizeFormat", "price", "unitPrice", "unitPriceLabel", "lastSeenAt")
       VALUES
         ($1, '4241', 'Leche semidesnatada Hacendado', 'Hacendado', '1 L', 0.89, 0.89, '€/L', now()),
         ($1, '9999', 'Producto sin dueño', NULL, NULL, 1.25, NULL, NULL, now()),
         ($2, $3, 'Cerveza Alhambra Tradicional', NULL, '33 cl', NULL, NULL, NULL, now())`,
      [MERCADONA, DEZA, sha1('cerveza alhambra tradicional|33 cl')]
    );

    // Two refs on the Mercadona row, which the old index allowed: the later
    // `lastResolvedAt` is the one that survives.
    await dataSource.query(
      `INSERT INTO "item_source_refs"
         ("itemId", "supermarketId", "externalId", "matchedBy", "status", "confidence", "lastResolvedAt")
       VALUES ($1, $2, '4241', 'EAN', 'ACTIVE', 1, '2026-09-02T00:00:00Z'),
              ($3, $2, '4241', 'NAME_BRAND_SIZE', 'MANUAL', 0.6, '2026-09-01T00:00:00Z')`,
      [ITEM_MILK, MERCADONA, ITEM_BEER]
    );
    // A ref against a product no run ever saw: dropped, counted and logged.
    await dataSource.query(
      `INSERT INTO "item_source_refs"
         ("itemId", "supermarketId", "externalId", "matchedBy", "status", "confidence")
       VALUES ($1, $2, 'never-walked', 'MANUAL', 'MANUAL', 1)`,
      [ITEM_ORPHAN, MERCADONA]
    );

    // Three aliases: one accepted, one queued, and one whose key collides with
    // the DEZA snapshot row, which is the meeting section 3 wanted.
    await dataSource.query(
      `INSERT INTO "source_aliases"
         ("supermarketId", "aliasKey", "printedName", "printedFormat", "printedBrand", "itemId", "status", "matchedBy", "confidence", "timesSeen")
       VALUES
         ($1, 'leche semidesnatada|1 l', 'LECHE SEMI', '1 L', 'Hacendado', $2, 'ACTIVE', 'MANUAL', 1, 4),
         ($1, 'galletas maria|800 g', 'GALLETAS MARIA', '800 g', NULL, NULL, 'UNRESOLVED', 'NAME_SIZE', 0, 1),
         ($3, 'cerveza alhambra tradicional|33 cl', 'CERVEZA ALHAMBRA', '33 cl', NULL, $4, 'ACTIVE', 'MANUAL', 1, 2)`,
      [MERCADONA, ITEM_MILK, DEZA, ITEM_BEER]
    );
  }

  function entries(): Promise<EntryRow[]> {
    return probe.query(
      `SELECT "externalId", "sourceKind", "name", "brand", "sizeFormat",
              "itemId", "status", "matchedBy", "confidence", "decidedAt", "timesSeen"
         FROM "source_catalog_entries" ORDER BY "externalId"`
    );
  }

  it('drops the two old tables and their types', async () => {
    const tables = await probe.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(
      tables.map((r: { table_name: string }) => r.table_name)
    );
    expect(names.has('source_catalog_entries')).toBe(true);
    expect(names.has('source_entry_prices')).toBe(true);
    expect(names.has('item_source_refs')).toBe(false);
    expect(names.has('source_aliases')).toBe(false);

    const types = await probe.query(
      `SELECT typname FROM pg_type WHERE typname = ANY($1)`,
      [['item_source_ref_status', 'source_alias_status', 'source_entry_status']]
    );
    const typeNames = new Set(types.map((r: { typname: string }) => r.typname));
    expect(typeNames.has('source_entry_status')).toBe(true);
    expect(typeNames.has('item_source_ref_status')).toBe(false);
    expect(typeNames.has('source_alias_status')).toBe(false);
  });

  it('rebuilds the two enums without REFRESH and without EXTERNAL_ID', async () => {
    const labels = async (type: string): Promise<string[]> => {
      const rows = await probe.query(
        `SELECT e.enumlabel FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = $1 ORDER BY e.enumsortorder`,
        [type]
      );
      return rows.map((r: { enumlabel: string }) => r.enumlabel);
    };

    expect(await labels('harvest_run_mode')).toEqual([
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
      'FILE_IMPORT',
    ]);
    expect(await labels('item_source_match')).toEqual([
      'EAN',
      'NAME_BRAND_SIZE',
      'NAME_SIZE',
      'MANUAL',
    ]);
  });

  it('deletes the REFRESH runs and renames the leaflet imports', async () => {
    const runs = await probe.query(
      `SELECT "id", "mode"::text AS mode FROM "harvest_runs" ORDER BY "id"`
    );
    const byId = new Map(
      runs.map((r: { id: string; mode: string }) => [r.id, r.mode])
    );
    // No cluster ever started a refresh, so what this deletes exists on
    // developer slots only.
    expect(byId.has(RUN_REFRESH)).toBe(false);
    expect(byId.get(RUN_WALK)).toBe('CATALOG_DISCOVERY');
    expect(byId.get(RUN_LEAFLET_A)).toBe('FILE_IMPORT');
    expect(byId.get(RUN_LEAFLET_B)).toBe('FILE_IMPORT');
  });

  it('gives every row a source kind, from the chain adapter where it is not an API', async () => {
    const rows = await entries();
    const kinds = new Map(rows.map((row) => [row.externalId, row.sourceKind]));

    expect(kinds.get('4241')).toBe('OFFICIAL_API');
    expect(kinds.get('9999')).toBe('OFFICIAL_API');
    // The DEZA chain renders a page, so its rows are OFFICIAL_WEB.
    expect(kinds.get(sha1('cerveza alhambra tradicional|33 cl'))).toBe(
      'OFFICIAL_WEB'
    );
  });

  it('moves a row price into one price row for the scope the chain wrote for', async () => {
    const prices = await probe.query(
      `SELECT p."price"::float AS price, p."unitPriceLabel", p."priceScopeId", p."runId",
              e."externalId"
         FROM "source_entry_prices" p
         JOIN "source_catalog_entries" e ON e."id" = p."entryId"
        ORDER BY e."externalId"`
    );

    expect(prices).toHaveLength(2);
    expect(prices[0]).toMatchObject({
      externalId: '4241',
      price: 0.89,
      unitPriceLabel: '€/L',
      priceScopeId: NATIONAL,
      // No walk recorded which run wrote the number, so there is none to name.
      runId: null,
    });
    // The DEZA row states no price, so it gets no row rather than a zero.
    expect(
      prices.some(
        (row: { externalId: string }) =>
          row.externalId === sha1('cerveza alhambra tradicional|33 cl')
      )
    ).toBe(false);

    const columns = await probe.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'source_catalog_entries'`
    );
    const names = new Set(
      columns.map((r: { column_name: string }) => r.column_name)
    );
    for (const gone of ['price', 'unitPrice', 'unitPriceLabel']) {
      expect(names.has(gone)).toBe(false);
    }
  });

  it('folds a ref onto its row, keeping the later of two and dropping an orphan', async () => {
    const rows = await entries();
    const milk = rows.find((row) => row.externalId === '4241');

    // The later `lastResolvedAt` wins, which is the EAN ref rather than the
    // MANUAL one a day earlier.
    expect(milk).toMatchObject({
      itemId: ITEM_MILK,
      status: 'ACTIVE',
      matchedBy: 'EAN',
    });
    expect(Number(milk?.confidence)).toBe(1);
    expect(milk?.decidedAt).toEqual(new Date('2026-09-02T00:00:00.000Z'));

    // The ref against a product no run ever saw has no row to fold into and no
    // name to give it, so it is dropped rather than invented.
    expect(rows.some((row) => row.externalId === 'never-walked')).toBe(false);

    // A row nothing resolved stays in the queue as UNRESOLVED.
    const orphan = rows.find((row) => row.externalId === '9999');
    expect(orphan).toMatchObject({ status: 'UNRESOLVED', matchedBy: null });
  });

  it('moves an alias in on sha1 of its key, keeping what the chain printed', async () => {
    const rows = await entries();
    const milkAlias = rows.find(
      (row) => row.externalId === sha1('leche semidesnatada|1 l')
    );

    expect(milkAlias).toMatchObject({
      sourceKind: 'OFFICIAL_LEAFLET',
      // The printed name, verbatim, whatever the item ended up called (D8).
      name: 'LECHE SEMI',
      brand: 'Hacendado',
      sizeFormat: '1 L',
      itemId: ITEM_MILK,
      status: 'ACTIVE',
      matchedBy: 'MANUAL',
    });
    expect(milkAlias?.timesSeen).toBe(4);

    const queued = rows.find(
      (row) => row.externalId === sha1('galletas maria|800 g')
    );
    expect(queued).toMatchObject({ status: 'UNRESOLVED', itemId: null });
  });

  it('lets a colliding alias decide the sibling row that had no decision', async () => {
    // The meeting section 3 wanted: a DEZA leaflet and the DEZA web listing name
    // one product, so they are one row, and the decision the alias carried wins
    // onto the row that had none.
    const rows = await entries();
    const meeting = rows.find(
      (row) => row.externalId === sha1('cerveza alhambra tradicional|33 cl')
    );

    expect(meeting).toMatchObject({
      // Still the crawl's row: the source group is not rewritten by the fold.
      sourceKind: 'OFFICIAL_WEB',
      name: 'Cerveza Alhambra Tradicional',
      itemId: ITEM_BEER,
      status: 'ACTIVE',
      matchedBy: 'MANUAL',
    });
    // One observation from each, added rather than replaced.
    expect(meeting?.timesSeen).toBe(3);
  });

  it('splits back into three tables on down, and says what it cannot restore', async () => {
    await probe.undoLastMigration({ transaction: 'each' });

    const tables = await probe.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(
      tables.map((r: { table_name: string }) => r.table_name)
    );
    expect(names.has('item_source_refs')).toBe(true);
    expect(names.has('source_aliases')).toBe(true);
    expect(names.has('source_entry_prices')).toBe(false);

    const aliases = await probe.query(
      `SELECT "printedName", "status"::text AS status FROM "source_aliases" ORDER BY "printedName"`
    );
    // Only the leaflet rows become aliases again. The DEZA row an alias decided
    // stays a snapshot row of the crawl that observed it, which is what
    // `sourceKind` says and what the split reads.
    expect(aliases.map((r: { printedName: string }) => r.printedName)).toEqual([
      'GALLETAS MARIA',
      'LECHE SEMI',
    ]);

    const refs = await probe.query(
      `SELECT "externalId", "itemId" FROM "item_source_refs" ORDER BY "externalId"`
    );
    expect(refs).toEqual([
      { externalId: '4241', itemId: ITEM_MILK },
      {
        externalId: sha1('cerveza alhambra tradicional|33 cl'),
        itemId: ITEM_BEER,
      },
    ]);

    const snapshot = await probe.query(
      `SELECT "externalId", "price"::float AS price FROM "source_catalog_entries" ORDER BY "externalId"`
    );
    expect(snapshot).toContainEqual({ externalId: '4241', price: 0.89 });

    // The REFRESH runs are gone for good, which the migration's own comment says.
    const runs = await probe.query(
      `SELECT count(*)::int AS count FROM "harvest_runs" WHERE "mode"::text = 'REFRESH'`
    );
    expect(runs[0].count).toBe(0);
  }, 60_000);
});
