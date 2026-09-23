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
import { SharedEan1757600000000 } from './migrations/1757600000000-SharedEan';

/**
 * The repair of plan 0155: every row the EAN rung bound whose EAN another row
 * of the same chain carries goes back to the queue.
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

/** Everything up to the one under test, which is the state the repair starts in. */
const BEFORE = HARVESTER_MIGRATIONS.slice(
  0,
  HARVESTER_MIGRATIONS.indexOf(SharedEan1757600000000)
);

const PROBE_DATABASE = 'luna_harvester_0155_probe';

const CHAIN = '01550155-0000-4000-a000-00000000000a';
const OTHER_CHAIN = '01550155-0000-4000-a000-00000000000b';
const SCOPE = '01550155-0000-4000-a000-00000000000c';

/** Five cuts of one fish under one EAN, one lone EAN, and a person's decision. */
const SEED: {
  supermarketId: string;
  externalId: string;
  ean: string;
  matchedBy: ItemSourceMatch;
  itemId: string;
}[] = [
  ...[1, 2, 3, 4, 5].map((cut) => ({
    supermarketId: CHAIN,
    externalId: `dorada-${cut}`,
    ean: '2300000000017',
    matchedBy: ItemSourceMatch.EAN,
    itemId: '01550155-0000-4000-a000-000000000001',
  })),
  {
    supermarketId: CHAIN,
    externalId: 'leche',
    ean: '8480000123456',
    matchedBy: ItemSourceMatch.EAN,
    itemId: '01550155-0000-4000-a000-000000000002',
  },
  {
    supermarketId: CHAIN,
    externalId: 'lubina-accepted',
    ean: '2300000000024',
    matchedBy: ItemSourceMatch.MANUAL,
    itemId: '01550155-0000-4000-a000-000000000003',
  },
  {
    supermarketId: CHAIN,
    externalId: 'lubina-ean',
    ean: '2300000000024',
    matchedBy: ItemSourceMatch.EAN,
    itemId: '01550155-0000-4000-a000-000000000004',
  },
  // The same EAN as the fish, alone in its own chain.
  {
    supermarketId: OTHER_CHAIN,
    externalId: 'dorada',
    ean: '2300000000017',
    matchedBy: ItemSourceMatch.EAN,
    itemId: '01550155-0000-4000-a000-000000000001',
  },
];

interface Row {
  externalId: string;
  supermarketId: string;
  status: SourceEntryStatus;
  matchedBy: ItemSourceMatch;
  itemId: string | null;
  confidence: string;
  decidedAt: Date | null;
}

describeIntegration('SharedEan1757600000000 (real Postgres)', () => {
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
    // One transaction for all, as `migrate.ts` runs them.
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

  async function seed(dataSource: DataSource): Promise<void> {
    for (const row of SEED) {
      const [{ id }] = await dataSource.query(
        `INSERT INTO "source_catalog_entries"
                ("supermarketId", "externalId", "sourceKind", "name", "ean",
                 "status", "matchedBy", "itemId", "confidence", "decidedAt")
         VALUES ($1, $2, $3, $2, $4, 'ACTIVE', $5, $6, 1, now())
         RETURNING "id"`,
        [
          row.supermarketId,
          row.externalId,
          PriceSourceKind.OFFICIAL_API,
          row.ean,
          row.matchedBy,
          row.itemId,
        ]
      );
      await dataSource.query(
        `INSERT INTO "source_entry_prices"
                ("entryId", "priceScopeId", "price", "currency", "observedAt")
         VALUES ($1, $2, 4.56, 'EUR', now())`,
        [id, SCOPE]
      );
    }
  }

  async function rows(): Promise<Map<string, Row>> {
    const all: Row[] = await probe.query(
      `SELECT "externalId", "supermarketId", "status", "matchedBy", "itemId",
              "confidence", "decidedAt"
         FROM "source_catalog_entries"`
    );
    return new Map(
      all.map((row) => [`${row.supermarketId}/${row.externalId}`, row])
    );
  }

  it('queues every row bound by an EAN its chain shares, keeping the item as the proposal', async () => {
    const byKey = await rows();
    for (const cut of [1, 2, 3, 4, 5]) {
      expect(byKey.get(`${CHAIN}/dorada-${cut}`)).toMatchObject({
        status: SourceEntryStatus.CANDIDATE,
        matchedBy: ItemSourceMatch.SHARED_EAN,
        itemId: '01550155-0000-4000-a000-000000000001',
        confidence: '0.600',
        decidedAt: null,
      });
    }
    expect(byKey.get(`${CHAIN}/lubina-ean`)).toMatchObject({
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.SHARED_EAN,
    });
  }, 180_000);

  it('leaves a lone EAN, another chain and a person alone', async () => {
    const byKey = await rows();
    for (const key of [
      `${CHAIN}/leche`,
      `${OTHER_CHAIN}/dorada`,
      `${CHAIN}/lubina-accepted`,
    ]) {
      expect(byKey.get(key)?.status).toBe(SourceEntryStatus.ACTIVE);
    }
    expect(byKey.get(`${CHAIN}/lubina-accepted`)?.matchedBy).toBe(
      ItemSourceMatch.MANUAL
    );
    expect(byKey.get(`${OTHER_CHAIN}/dorada`)?.matchedBy).toBe(
      ItemSourceMatch.EAN
    );
  }, 180_000);

  it('deletes no price row', async () => {
    const [{ count }] = await probe.query(
      `SELECT count(*)::int AS "count" FROM "source_entry_prices"`
    );
    expect(count).toBe(SEED.length);
  }, 180_000);

  it('changes nothing when it runs again', async () => {
    const before = await rows();
    const runner = probe.createQueryRunner();
    try {
      await new SharedEan1757600000000().up(runner);
    } finally {
      await runner.release();
    }
    const after = await rows();

    expect(after).toEqual(before);
  }, 180_000);

  it('the type holds the new label on both columns that use it', async () => {
    const labels: { enumlabel: string }[] = await probe.query(
      `SELECT e.enumlabel
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'item_source_match'
        ORDER BY e.enumsortorder`
    );
    expect(labels.map((label) => label.enumlabel)).toEqual([
      'EAN',
      'NAME_BRAND_SIZE',
      'NAME_SIZE',
      'MANUAL',
      'SHARED_EAN',
    ]);
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
});
