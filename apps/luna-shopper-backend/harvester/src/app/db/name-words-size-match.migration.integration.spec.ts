import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES } from '../entities';
import { HARVESTER_MIGRATIONS } from './migrations';
import { NameWordsSizeMatch1760200000000 } from './migrations/1760200000000-NameWordsSizeMatch';

/**
 * `item_source_match` gains `NAME_WORDS_SIZE` (plan 0221), and `down` takes it
 * away again the way `SharedEan` does.
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: `down` rebuilds a type, which is not a thing
 * to do to the slot's own database. Run it with `LUNA_INTEGRATION=1` and the
 * `HARVESTER_DB_URL` of a throwaway ephemeral slot, through the
 * `test-integration` target.
 */

const PROBE_DATABASE = 'luna_harvester_0221_probe';

const CHAIN = '02210221-0000-4000-a000-00000000000a';
const ITEM = '02210221-0000-4000-a000-000000000001';

/** Every label the type held before this plan, in order. */
const BEFORE_LABELS = [
  'EAN',
  'NAME_BRAND_SIZE',
  'NAME_SIZE',
  'MANUAL',
  'SHARED_EAN',
];

describeIntegration('NameWordsSizeMatch1760200000000 (real Postgres)', () => {
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
    probe = new DataSource({
      type: 'postgres',
      url: url.toString(),
      entities: HARVESTER_ENTITIES,
      migrations: HARVESTER_MIGRATIONS,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
    // One transaction for all, as `migrate.ts` runs them. Postgres refuses a
    // label `ADD VALUE` added in the same transaction only when it is used.
    await probe.runMigrations({ transaction: 'all' });
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

  async function labels(): Promise<string[]> {
    const rows: { enumlabel: string }[] = await probe.query(
      `SELECT e.enumlabel
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'item_source_match'
        ORDER BY e.enumsortorder`
    );
    return rows.map((row) => row.enumlabel);
  }

  async function insert(externalId: string, matchedBy: string): Promise<void> {
    await probe.query(
      `INSERT INTO "source_catalog_entries"
              ("supermarketId", "externalId", "sourceKind", "name",
               "status", "matchedBy", "itemId", "confidence")
       VALUES ($1, $2, $3, $2, 'CANDIDATE', $4, $5, 0.6)`,
      [CHAIN, externalId, PriceSourceKind.OFFICIAL_WEB, matchedBy, ITEM]
    );
  }

  /** Only the columns this spec is about, read as raw rows. */
  async function row(externalId: string): Promise<{
    status: string;
    matchedBy: string | null;
    itemId: string | null;
    confidence: string;
  }> {
    const [found] = await probe.query(
      `SELECT "status", "matchedBy", "itemId", "confidence"
         FROM "source_catalog_entries"
        WHERE "supermarketId" = $1 AND "externalId" = $2`,
      [CHAIN, externalId]
    );
    return found;
  }

  async function run(step: 'up' | 'down'): Promise<void> {
    const runner = probe.createQueryRunner();
    try {
      await new NameWordsSizeMatch1760200000000()[step](runner);
    } finally {
      await runner.release();
    }
  }

  it('adds the value last, on the type both columns use', async () => {
    expect(await labels()).toEqual([...BEFORE_LABELS, 'NAME_WORDS_SIZE']);
    const columns: { table_name: string; udt_name: string }[] =
      await probe.query(
        `SELECT table_name, udt_name FROM information_schema.columns
          WHERE column_name = 'matchedBy' AND table_schema = 'public'
          ORDER BY table_name`
      );
    expect(columns).toEqual([
      { table_name: 'source_catalog_entries', udt_name: 'item_source_match' },
      { table_name: 'source_locations', udt_name: 'item_source_match' },
    ]);
  }, 180_000);

  it('saves a row with the value', async () => {
    await insert('reworded', ItemSourceMatch.NAME_WORDS_SIZE);
    await insert('exact', ItemSourceMatch.NAME_SIZE);

    expect(await row('reworded')).toEqual({
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.NAME_WORDS_SIZE,
      itemId: ITEM,
      confidence: '0.600',
    });
  }, 180_000);

  it('runs again without failing, and adds nothing twice', async () => {
    await run('up');

    expect(await labels()).toEqual([...BEFORE_LABELS, 'NAME_WORDS_SIZE']);
  }, 180_000);

  it('down moves such rows back to NAME_SIZE, keeps the proposal, and removes the value', async () => {
    await run('down');

    expect(await labels()).toEqual(BEFORE_LABELS);
    expect(await row('reworded')).toEqual({
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.NAME_SIZE,
      itemId: ITEM,
      confidence: '0.600',
    });
    expect((await row('exact')).matchedBy).toBe(ItemSourceMatch.NAME_SIZE);
    await expect(
      insert('after-down', ItemSourceMatch.NAME_WORDS_SIZE)
    ).rejects.toThrow(/invalid input value for enum/);

    // And up again, which is what the next deploy after a rollback does.
    await run('up');
    expect(await labels()).toEqual([...BEFORE_LABELS, 'NAME_WORDS_SIZE']);
  }, 180_000);
});
