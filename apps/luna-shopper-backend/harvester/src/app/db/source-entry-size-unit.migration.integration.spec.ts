import {
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES, SourceCatalogEntry } from '../entities';
import { applySourceGroup } from '../harvest/source-snapshot';
import { HARVESTER_MIGRATIONS } from './migrations';
import { SourceEntrySizeUnit1758000000000 } from './migrations/1758000000000-SourceEntrySizeUnit';

/**
 * The size unit column, and what it must not move (plan 0177).
 *
 * Three claims, and none can be made without a real database:
 *
 * - **Existing rows keep `sizeFormat` and `externalId`**, byte for byte. The
 *   first is half of the alias key (plan 0081) and the second is the row's
 *   identity, and a changed key detaches every leaflet alias and every replay
 *   of a curation export.
 * - **Nothing is backfilled.** A row written before the plan holds a null
 *   unit until a run sees it again, because the printed text cannot say which
 *   unit its number is in: that guess is what the column replaces.
 * - **The column holds only the five units a size is measured in.**
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state *before* the migration,
 * which cannot be reached on a database that already has it.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/**
 * The list up to and including the one under test, and everything before it,
 * which is the state the rows start in. A prefix rather than a filter, so a
 * migration added after this one never runs against the old schema here.
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SourceEntrySizeUnit1758000000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0177_probe';

const CHAIN = '01770177-0000-4000-a000-00000000000a';

interface SizedRow {
  externalId: string;
  name: string;
  unitSize: string | null;
  sizeFormat: string | null;
  sizeUnit: string | null;
  packCount: number | null;
}

/**
 * One row per shape the plan measured in the queue, as the sources wrote them
 * before it: the number, the printed text, and nothing saying which unit.
 */
const SEED: [string, string, number | null, string | null][] = [
  ['mercadona-4241', 'Queso curado', 0.4636, 'kg'],
  ['lidl-75cl', 'Vino tinto', 750, '75cl'],
  ['lidl-128l', 'Zumo de naranja', 1.28, '1,28 l'],
  ['eljamon-6x33cl', 'Cerveza rubia', 198, '6x33cl'],
  ['deza-hash-75cl', 'Cava rosé', null, '75 cl'],
  ['deza-hash-16ud', 'Café con leche', null, '16 ud'],
  ['leaflet-hash-75cl', 'Vino verdejo', 750, '75 cl'],
  ['no-size', 'Bolsa reutilizable', null, null],
];

describeIntegration('SourceEntrySizeUnit1758000000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let before: SizedRow[];

  const read = (dataSource: DataSource): Promise<SizedRow[]> =>
    dataSource.query(
      `SELECT "externalId", "name", "unitSize", "sizeFormat", "packCount",
              to_jsonb(e) ->> 'sizeUnit' AS "sizeUnit"
         FROM "source_catalog_entries" e
        WHERE "supermarketId" = $1
        ORDER BY "externalId"`,
      [CHAIN]
    );

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
    for (const [externalId, name, unitSize, sizeFormat] of SEED) {
      await probe.query(
        `INSERT INTO "source_catalog_entries"
                ("supermarketId", "externalId", "sourceKind", "name",
                 "unitSize", "sizeFormat", "status")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          CHAIN,
          externalId,
          PriceSourceKind.OFFICIAL_API,
          name,
          unitSize,
          sizeFormat,
          SourceEntryStatus.UNRESOLVED,
        ]
      );
    }
    before = await read(probe);

    // The migration itself, as its own data source, so the migrations table
    // carries exactly the state a real deployment's does when this one runs.
    await probe.destroy();
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: HARVESTER_ENTITIES,
      migrations: THROUGH,
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

  it('is newer than every migration before it', () => {
    const stamps = BEFORE.map((migration) =>
      Number(/(\d{13})$/.exec(migration.name)?.[1])
    );
    expect(stamps.length).toBeGreaterThan(0);
    expect(Math.max(...stamps)).toBeLessThan(1758000000000);
  });

  it('keeps sizeFormat and externalId of every existing row', async () => {
    const after = await read(probe);

    expect(before).toHaveLength(SEED.length);
    expect(
      after.map(({ externalId, sizeFormat }) => [externalId, sizeFormat])
    ).toEqual(
      before.map(({ externalId, sizeFormat }) => [externalId, sizeFormat])
    );
    // The number is not touched either: converting it is a run's to do, with
    // the adapter that knows what the chain printed.
    expect(after.map((row) => row.unitSize)).toEqual(
      before.map((row) => row.unitSize)
    );
    expect(after.map((row) => row.name)).toEqual(before.map((row) => row.name));
  }, 180_000);

  it('backfills nothing: an existing row holds no unit until a run sees it', async () => {
    const after = await read(probe);

    expect(before.every((row) => row.sizeUnit === null)).toBe(true);
    expect(after.every((row) => row.sizeUnit === null)).toBe(true);
  }, 180_000);

  it('a run writes the unit beside the size, and the key stays what it was', async () => {
    const entries = probe.getRepository(SourceCatalogEntry);
    const row = await entries.findOneByOrFail({
      supermarketId: CHAIN,
      externalId: 'eljamon-6x33cl',
    });

    // What the El Jamón adapter states for this row after the plan: the same
    // printed text, the size in millilitres, and the unit that says so.
    applySourceGroup(row, {
      externalId: row.externalId,
      sourceKind: row.sourceKind,
      name: row.name,
      brand: row.brand,
      brandKey: row.brandKey,
      ean: row.ean,
      unitSize: 1980,
      sizeUnit: UnitOfMeasure.MILLILITER,
      sizeFormat: row.sizeFormat,
      packCount: 6,
      categoryPath: row.categoryPath,
      url: row.url,
      extra: row.extra,
    });
    await entries.save(row);

    const stored = (await read(probe)).find(
      (entry) => entry.externalId === 'eljamon-6x33cl'
    );
    expect(stored).toMatchObject({
      externalId: 'eljamon-6x33cl',
      sizeFormat: '6x33cl',
      sizeUnit: 'MILLILITER',
      packCount: 6,
    });
    expect(Number(stored?.unitSize)).toBe(1980);
  }, 180_000);

  it('refuses a unit a size is not measured in', async () => {
    const write = (unit: string) =>
      probe.query(
        `UPDATE "source_catalog_entries" SET "sizeUnit" = $1
          WHERE "supermarketId" = $2 AND "externalId" = 'no-size'`,
        [unit, CHAIN]
      );

    // A pack is counted by `packCount`, and a centilitre is not a catalog unit.
    await expect(write('PACK')).rejects.toThrow(
      /chk_source_catalog_entries_size_unit/
    );
    await expect(write('cl')).rejects.toThrow(
      /chk_source_catalog_entries_size_unit/
    );
    await expect(write('UNIT')).resolves.toBeDefined();
  }, 180_000);

  it('comes back down to the schema it started from', async () => {
    await probe.undoLastMigration({ transaction: 'each' });

    const columns: { column_name: string }[] = await probe.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'source_catalog_entries'`
    );
    expect(columns.map((column) => column.column_name)).not.toContain(
      'sizeUnit'
    );
    expect(
      (await read(probe)).map(({ externalId, sizeFormat }) => [
        externalId,
        sizeFormat,
      ])
    ).toEqual(
      before.map(({ externalId, sizeFormat }) => [externalId, sizeFormat])
    );
  }, 180_000);
});
