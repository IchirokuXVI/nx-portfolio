import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES, SourceCatalogEntry } from '../entities';
import { applySourceGroup } from '../harvest/source-snapshot';
import { HARVESTER_MIGRATIONS } from './migrations';
import { SourceEntryBrandKey1757200000000 } from './migrations/1757200000000-SourceEntryBrandKey';

/**
 * The brand key column, its backfill and the write path that keeps it current
 * (plan 0115, sections 6 and 10).
 *
 * Two claims, and neither can be made without a real database:
 *
 * - **Existing rows are keyed**, with the key `brandKey` produces rather than
 *   one a SQL expression approximates. `Campofrio` with its accent is the case
 *   that separates them: no database here has `unaccent`.
 * - **`brand` is untouched**, here and everywhere in plan 0115. What a chain
 *   printed is the run's to state, and a decision never rewrites it (plan 0086,
 *   D8).
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state *before* the migration,
 * which cannot be reached on a database that already has it.
 *
 *   docker run -d --name tmp-pg-harvester -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=harvester -p 45992:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://postgres:pw@localhost:45992/harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/** Everything before the one under test, which is the state the backfill starts in. */
const BEFORE = HARVESTER_MIGRATIONS.filter(
  (migration) => migration !== SourceEntryBrandKey1757200000000
);

const PROBE_DATABASE = 'luna_harvester_0115_probe';

const CHAIN = '01150115-0000-4000-a000-00000000000a';

interface KeyedRow {
  name: string;
  brand: string | null;
  brandKey: string | null;
}

describeIntegration('SourceEntryBrandKey1757200000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing that makes the next one fail
    // on a database that already exists.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

    url.pathname = `/${PROBE_DATABASE}`;
    const probeUrl = url.toString();

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

    // The migration itself, as its own data source, so the migrations table
    // carries exactly the state a real deployment's does when this one runs.
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

  /** Rows whose brands cover every case section 2 names. */
  async function seed(dataSource: DataSource): Promise<void> {
    const brands: [string, string | null][] = [
      ['Cerveza', 'MAHOU'],
      ['Jamon', 'El Pozo'],
      ['Chorizo', 'Campofrío'],
      ['Oferta', '---'],
      ['Generico', null],
    ];
    for (const [index, [name, brand]] of brands.entries()) {
      await dataSource.query(
        `INSERT INTO "source_catalog_entries"
                ("supermarketId", "externalId", "sourceKind", "name", "brand", "status")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          CHAIN,
          `plan0115-seed-${index}`,
          PriceSourceKind.OFFICIAL_API,
          name,
          brand,
          SourceEntryStatus.UNRESOLVED,
        ]
      );
    }
  }

  it('keys every branded row, and leaves what the chain printed alone', async () => {
    const rows: KeyedRow[] = await probe.query(
      `SELECT "name", "brand", "brandKey" FROM "source_catalog_entries"`
    );
    const byName = new Map(rows.map((row) => [row.name, row]));

    expect(byName.get('Cerveza')?.brandKey).toBe('mahou');
    expect(byName.get('Jamon')?.brandKey).toBe('elpozo');
    // The accent is the case a SQL backfill gets wrong.
    expect(byName.get('Chorizo')?.brandKey).toBe('campofrio');
    // A text with no letters or digits has no key.
    expect(byName.get('Oferta')?.brandKey).toBeNull();
    expect(byName.get('Generico')?.brandKey).toBeNull();

    // Verbatim, every one of them (plan 0086, D8).
    expect(byName.get('Cerveza')?.brand).toBe('MAHOU');
    expect(byName.get('Chorizo')?.brand).toBe('Campofrío');
    expect(byName.get('Oferta')?.brand).toBe('---');
  }, 180_000);

  it('the write path keys the brand it writes', async () => {
    const entries = probe.getRepository(SourceCatalogEntry);
    const row = entries.create({
      supermarketId: CHAIN,
      externalId: 'plan0115-write',
      sourceKind: PriceSourceKind.OFFICIAL_API,
      name: 'Refresco',
      brand: null,
      brandKey: null,
      ean: null,
      unitSize: null,
      sizeFormat: null,
      categoryPath: [],
      url: null,
      extra: null,
      status: SourceEntryStatus.UNRESOLVED,
    });

    // The one function a run writes the source group through. Everything below
    // it in the ingest reaches the row this way, so keying here is what makes
    // every path carry the key.
    applySourceGroup(row, {
      externalId: 'plan0115-write',
      sourceKind: PriceSourceKind.OFFICIAL_API,
      name: 'Refresco',
      brand: 'Coca-Cola',
      brandKey: 'cocacola',
      ean: null,
      unitSize: null,
      sizeFormat: null,
      categoryPath: [],
      url: null,
      extra: null,
    });
    await entries.save(row);

    const [stored]: KeyedRow[] = await probe.query(
      `SELECT "name", "brand", "brandKey" FROM "source_catalog_entries"
        WHERE "externalId" = 'plan0115-write'`
    );
    expect(stored).toMatchObject({ brand: 'Coca-Cola', brandKey: 'cocacola' });
  }, 180_000);

  it('indexes only the queued rows that have a key', async () => {
    const [index] = await probe.query(
      `SELECT indexdef FROM pg_indexes
        WHERE indexname = 'ix_source_catalog_entries_queued_brand_key'`
    );
    // Partial, because the only read of the column is the suggestions query and
    // that query is always about the queue.
    expect(index.indexdef).toContain('CANDIDATE');
    expect(index.indexdef).toContain('UNRESOLVED');
  }, 180_000);
});
