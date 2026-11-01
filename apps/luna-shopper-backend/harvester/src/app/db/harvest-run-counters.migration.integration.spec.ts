import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_MIGRATIONS } from './migrations';
import { HarvestRunCounters1759600000000 } from './migrations/1759600000000-HarvestRunCounters';

/**
 * The counters of old runs, corrected where the report makes it exact (plan
 * 0217, section 5).
 *
 * Three claims that need a real database:
 *
 * - **A run whose report states `pricesPublished` loses that amount from
 *   `updated`**, and nothing else moves.
 * - **A Carrefour backfill after plan 0103 counted each EAN two times**, so it
 *   loses `eansWritten` from `updated` and `processed`, and its `notFound`
 *   becomes 0. A backfill with no `productsWritten` was counted once and keeps
 *   its numbers.
 * - **A row the report does not make exact keeps its numbers**, and `down`
 *   puts every corrected row back.
 *
 * It runs against a probe database of its own, for the reason the
 * `OneSourceProduct` spec gives: the point is the state before the migration.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const THROUGH = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(HarvestRunCounters1759600000000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_harvester_0217_probe';

const CHAIN = '02170217-0000-4000-a000-00000000000c';

interface Counters {
  processed: number;
  updated: number;
  unchanged: number;
  notFound: number;
}

interface Seed {
  id: string;
  counters: Counters;
  report: Record<string, unknown>;
}

const run = (n: number) =>
  `02170217-0000-4000-a000-0000000000${String(n).padStart(2, '0')}`;

/** The runs as the harvester wrote them before the plan. */
const WALK = run(1);
const BACKFILL = run(2);
const NO_KEY = run(3);
const OLD_BACKFILL = run(4);
const NOT_A_COUNT = run(5);
const SHORT = run(6);

const SEED: Seed[] = [
  {
    // A walk that changed 10 rows and published 40 prices.
    id: WALK,
    counters: { processed: 60, updated: 50, unchanged: 50, notFound: 2 },
    report: { productsWritten: 60, pricesRecorded: 45, pricesPublished: 40 },
  },
  {
    // A backfill after plan 0103: 5 EANs counted twice, 2 pages with none.
    id: BACKFILL,
    counters: { processed: 12, updated: 7, unchanged: 3, notFound: 2 },
    report: {
      pending: 7,
      eansWritten: 5,
      noEanOnTheirPage: 2,
      productsWritten: 5,
      pricesPublished: 0,
    },
  },
  {
    // A run whose report holds none of the keys: failed early, or older.
    id: NO_KEY,
    counters: { processed: 9, updated: 8, unchanged: 1, notFound: 0 },
    report: {},
  },
  {
    // A backfill from before plan 0103, which counted each EAN once.
    id: OLD_BACKFILL,
    counters: { processed: 6, updated: 4, unchanged: 0, notFound: 2 },
    report: { pending: 6, eansWritten: 4, noEanOnTheirPage: 2 },
  },
  {
    // A key that is not a whole count is not an exact amount.
    id: NOT_A_COUNT,
    counters: { processed: 5, updated: 5, unchanged: 0, notFound: 0 },
    report: { pricesPublished: '3' },
  },
  {
    // A report that states more than the counter holds stops at zero.
    id: SHORT,
    counters: { processed: 4, updated: 3, unchanged: 1, notFound: 0 },
    report: { pricesPublished: 7 },
  },
];

describeIntegration('HarvestRunCounters1759600000000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  const read = async (): Promise<Map<string, Counters>> => {
    const rows: Array<Counters & { id: string }> = await probe.query(
      `SELECT "id", "processed", "updated", "unchanged", "notFound"
           FROM "harvest_runs"`
    );
    return new Map(
      rows.map(({ id, ...counters }) => [id, counters as Counters])
    );
  };

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
    for (const seed of SEED) {
      // Finished, because a chain holds one run at a time that is not.
      await probe.query(
        `INSERT INTO "harvest_runs"
                  ("id", "supermarketId", "mode", "status", "input",
                   "processed", "updated", "unchanged", "notFound", "report")
             VALUES ($1, $2, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb,
                     $3, $4, $5, $6, $7::jsonb)`,
        [
          seed.id,
          CHAIN,
          seed.counters.processed,
          seed.counters.updated,
          seed.counters.unchanged,
          seed.counters.notFound,
          JSON.stringify(seed.report),
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
    expect(Math.max(...stamps)).toBeLessThan(1759600000000);
  });

  it('takes the published prices out of updated, and nothing else', async () => {
    const rows = await read();

    expect(rows.get(WALK)).toEqual({
      processed: 60,
      updated: 10,
      unchanged: 50,
      notFound: 2,
    });
  }, 180_000);

  it('counts each EAN of a backfill once, and no page as not found', async () => {
    const rows = await read();

    expect(rows.get(BACKFILL)).toEqual({
      processed: 7,
      updated: 2,
      unchanged: 3,
      notFound: 0,
    });
  }, 180_000);

  it('keeps the numbers of a row its report does not make exact', async () => {
    const rows = await read();

    for (const id of [NO_KEY, OLD_BACKFILL, NOT_A_COUNT]) {
      const seed = SEED.find((each) => each.id === id);
      expect([id, rows.get(id)]).toEqual([id, seed?.counters]);
    }
  }, 180_000);

  it('never takes a counter below zero', async () => {
    const rows = await read();

    expect(rows.get(SHORT)?.updated).toBe(0);
  }, 180_000);

  it('goes down to the numbers as they were, and up again to the same correction', async () => {
    const migration = new HarvestRunCounters1759600000000();
    const runner = probe.createQueryRunner();
    try {
      await migration.down(runner);
      const down = await read();
      // Every row whose counter held at least what its report states.
      for (const seed of SEED.filter((each) => each.id !== SHORT)) {
        expect([seed.id, down.get(seed.id)]).toEqual([seed.id, seed.counters]);
      }

      await migration.up(runner);
    } finally {
      await runner.release();
    }
    const again = await read();
    expect(again.get(WALK)?.updated).toBe(10);
    expect(again.get(BACKFILL)).toMatchObject({ processed: 7, notFound: 0 });
  }, 180_000);
});
