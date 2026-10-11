import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { SourceEntryImageUrl1759300000000 } from './migrations/1759300000000-SourceEntryImageUrl';

/**
 * The photo address column, and the one copy it makes (plan 0198, section 2).
 *
 * Three claims that need a real database:
 *
 * - **The DIA copy takes an address only when a new read would.** The DIA
 *   runner kept the absolute address under `extra.image`. The copy takes it
 *   when it is an `https` address on DIA's own host that fits the column, and
 *   leaves every other value where it was.
 * - **No other chain is touched**, whatever its `extra` holds: the copy reads
 *   the adapter of the chain, and `extra` is a bag nothing may interpret.
 * - **`down` drops the column and loses nothing**, because `extra` is not
 *   changed in either direction.
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state before the migration.
 * Every read and write here is SQL, so a later plan's column cannot break it.
 *
 * No address is opened. Every assertion is on strings.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SourceEntryImageUrl1759300000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0198_probe';

const DIA = '01980198-0000-4000-a000-00000000000d';
const MERCADONA = '01980198-0000-4000-a000-00000000000e';
/** A chain that no source row describes, as a file import allows. */
const NO_SOURCE = '01980198-0000-4000-a000-00000000000f';

const DIA_PHOTO = 'https://www.dia.es/product_images/38406/38406_ISO_0_ES.jpg';

/** `[chain, externalId, extra]`, as the runs wrote them before the plan. */
const SEED: [string, string, Record<string, unknown> | null][] = [
  [DIA, 'dia-photo', { image: DIA_PHOTO, diaCategoryIds: ['L2108'] }],
  [DIA, 'dia-no-photo', { diaCategoryIds: ['L2108'] }],
  [DIA, 'dia-null-extra', null],
  [DIA, 'dia-http', { image: 'http://www.dia.es/product_images/1/1.jpg' }],
  [DIA, 'dia-foreign', { image: 'https://cdn.example.org/1.jpg' }],
  [DIA, 'dia-lookalike', { image: 'https://www.dia.es.example.org/1.jpg' }],
  [DIA, 'dia-long', { image: `${DIA_PHOTO}?v=${'a'.repeat(500)}` }],
  [DIA, 'dia-not-a-string', { image: { url: DIA_PHOTO } }],
  [MERCADONA, 'mercadona-bag', { image: DIA_PHOTO }],
  [NO_SOURCE, 'no-source-bag', { image: DIA_PHOTO }],
];

interface Row {
  externalId: string;
  imageUrl: string | null;
  extra: Record<string, unknown> | null;
}

describeIntegration('SourceEntryImageUrl1759300000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  const read = (): Promise<Row[]> =>
    probe.query(
      `SELECT "externalId",
                to_jsonb(e) ->> 'imageUrl' AS "imageUrl",
                "extra"
           FROM "source_catalog_entries" e
          ORDER BY "externalId"`
    );
  const byId = async (): Promise<Map<string, Row>> =>
    new Map((await read()).map((row) => [row.externalId, row]));

  const open = async (migrations: typeof THROUGH) => {
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      migrations,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    await probe.runMigrations({ transaction: 'each' });
  };

  beforeAll(async () => {
    const url = new URL(requiredEnv('HARVESTER_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing behind for the next one.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
    url.pathname = `/${PROBE_DATABASE}`;
    probeUrl = url.toString();

    await open(BEFORE);
    for (const [supermarketId, adapterKey] of [
      [DIA, 'dia-api'],
      [MERCADONA, 'mercadona-api'],
    ]) {
      await probe.query(
        `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey")
           VALUES ($1, $2)`,
        [supermarketId, adapterKey]
      );
    }
    for (const [supermarketId, externalId, extra] of SEED) {
      await probe.query(
        `INSERT INTO "source_catalog_entries"
                  ("supermarketId", "externalId", "sourceKind", "name",
                   "status", "extra")
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          supermarketId,
          externalId,
          PriceSourceKind.OFFICIAL_API,
          `Producto ${externalId}`,
          SourceEntryStatus.UNRESOLVED,
          extra === null ? null : JSON.stringify(extra),
        ]
      );
    }
    await probe.destroy();
    // The migration itself, as its own data source, so the migrations table
    // carries the state a real deployment's does when this one runs.
    await open(THROUGH);
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
    expect(Math.max(...stamps)).toBeLessThan(1759300000000);
  });

  it('copies the address the DIA runner stored, and only one a new read would take', async () => {
    const rows = await byId();

    expect(rows.get('dia-photo')?.imageUrl).toBe(DIA_PHOTO);
    for (const refused of [
      'dia-no-photo',
      'dia-null-extra',
      'dia-http',
      'dia-foreign',
      'dia-lookalike',
      'dia-long',
      'dia-not-a-string',
    ]) {
      expect([refused, rows.get(refused)?.imageUrl]).toEqual([refused, null]);
    }
  }, 180_000);

  it('reads the bag of no other chain', async () => {
    const rows = await byId();

    expect(rows.get('mercadona-bag')?.imageUrl).toBeNull();
    expect(rows.get('no-source-bag')?.imageUrl).toBeNull();
  }, 180_000);

  it('leaves every bag as it was', async () => {
    const rows = await byId();

    for (const [, externalId, extra] of SEED) {
      expect([externalId, rows.get(externalId)?.extra]).toEqual([
        externalId,
        extra,
      ]);
    }
  }, 180_000);

  it('holds an address of at most 500 characters', async () => {
    const longest = `https://www.dia.es/${'a'.repeat(481)}`;
    expect(longest).toHaveLength(500);
    await probe.query(
      `UPDATE "source_catalog_entries" SET "imageUrl" = $1
          WHERE "externalId" = 'dia-no-photo'`,
      [longest]
    );
    await expect(
      probe.query(
        `UPDATE "source_catalog_entries" SET "imageUrl" = $1
            WHERE "externalId" = 'dia-no-photo'`,
        [`${longest}a`]
      )
    ).rejects.toThrow(/too long/);
    await probe.query(
      `UPDATE "source_catalog_entries" SET "imageUrl" = NULL
          WHERE "externalId" = 'dia-no-photo'`
    );
  }, 180_000);

  it('goes down to the rows as they were, and up again to the same copy', async () => {
    const migration = new SourceEntryImageUrl1759300000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);
      const down = await byId();
      expect([...down.values()].every((row) => row.imageUrl === null)).toBe(
        true
      );
      // The bag still holds the address, so nothing was lost.
      expect(down.get('dia-photo')?.extra).toEqual({
        image: DIA_PHOTO,
        diaCategoryIds: ['L2108'],
      });

      await migration.up(runner);
    } finally {
      await runner.release();
    }
    const again = await byId();
    expect(again.get('dia-photo')?.imageUrl).toBe(DIA_PHOTO);
    expect(again.get('dia-foreign')?.imageUrl).toBeNull();
  }, 180_000);
});
