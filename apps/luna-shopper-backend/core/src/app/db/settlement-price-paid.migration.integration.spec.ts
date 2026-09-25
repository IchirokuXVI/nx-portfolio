import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { SettlementPricePaid1756003100000 } from './migrations/1756003100000-SettlementPricePaid';

/**
 * What was paid, recorded at the shelf (plan 0143, section 9, tests 15 and 16).
 *
 * Against a probe database of its own, as plan 0134's migration spec is and for
 * the same reason: the claims are about a table with and without two columns,
 * which cannot both be true of the database the other suites share.
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - Each of the four check constraints refuses exactly what it is for. They are
 *   the plan's guarantees about money, and a service is not where a guarantee
 *   about money belongs.
 * - `down` and `up` again both run on a table that **holds** priced
 *   settlements. That is the case the plan's first draft of `down` got wrong:
 *   it dropped the currency and left the amount, which is a row its own
 *   `ck_line_settlements_price` then refuses on the way back up.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(SettlementPricePaid1756003100000) + 1
);

const PROBE_DATABASE = 'luna_core_0143_probe';

const ZONE = '01430143-0000-4000-a000-00000000000a';
const LIST = '01430143-0000-4000-a000-00000000000b';
const LINE = '01430143-0000-4000-a000-00000000000c';
const OWNER = '01430143-0000-4000-a000-00000000000d';
/** A chain's catchment and one of its shops, opaque to core. */
const SCOPE = '01430143-1111-4000-a000-000000000001';
const SHOP = '01430143-1111-4000-a000-000000000002';

describeIntegration('SettlementPricePaid1756003100000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  async function open(): Promise<void> {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: CORE_ENTITIES,
      migrations: THROUGH,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
  }

  /** One settlement, with whichever of the four price columns are given. */
  function settle(
    columns: {
      outcome?: string;
      pricePaidCents?: number | null;
      pricePaidCurrency?: string | null;
      priceScopeId?: string | null;
      supermarketLocationId?: string | null;
    } = {}
  ): Promise<unknown> {
    return probe.query(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "itemId", "outcome", "quantity",
          "settledByUserId", "settledAt",
          "pricePaidCents", "pricePaidCurrency",
          "priceScopeId", "supermarketLocationId")
       VALUES ($1, $2, NULL, $3, 1, $4, now(), $5, $6, $7, $8)`,
      [
        LINE,
        LIST,
        columns.outcome ?? 'BOUGHT',
        OWNER,
        columns.pricePaidCents ?? null,
        columns.pricePaidCurrency ?? null,
        columns.priceScopeId ?? null,
        columns.supermarketLocationId ?? null,
      ]
    );
  }

  beforeAll(async () => {
    const url = new URL(requiredEnv('CORE_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing the next one fails on.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
    url.pathname = `/${PROBE_DATABASE}`;
    probeUrl = url.toString();

    await open();
    await probe.runMigrations({ transaction: 'each' });

    await probe.query(
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
       VALUES ($1, 'Home', 'P0143P0143P0143', 'ACTIVE', '{}'::jsonb)`,
      [ZONE]
    );
    await probe.query(
      `INSERT INTO "shopping_lists" ("id", "zoneId", "name", "createdByUserId")
       VALUES ($1, $2, 'Weekly shop', $3)`,
      [LIST, ZONE, OWNER]
    );
    await probe.query(
      `INSERT INTO "list_lines"
         ("id", "listId", "content", "quantity", "position", "createdByUserId")
       VALUES ($1, $2, 'Milk', 2, 1, $3)`,
      [LINE, LIST, OWNER]
    );
  }, 300_000);

  afterAll(async () => {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  });

  afterEach(async () => {
    await probe.query(`DELETE FROM "line_settlements"`);
  });

  describe('what the four constraints refuse (test 15)', () => {
    it('accepts a price with its currency, its scope and its shop', async () => {
      await expect(
        settle({
          pricePaidCents: 129,
          pricePaidCurrency: 'EUR',
          priceScopeId: SCOPE,
          supermarketLocationId: SHOP,
        })
      ).resolves.toBeDefined();
    });

    // An amount of money with no currency is a number, and every sum over it is
    // only honest while every row happens to be in euros (section 2).
    it.each([
      ['a price with no currency', { pricePaidCents: 129 }],
      ['a currency with no price', { pricePaidCurrency: 'EUR' }],
    ])('refuses %s', async (_name, columns) => {
      await expect(settle({ ...columns, priceScopeId: SCOPE })).rejects.toThrow(
        /ck_line_settlements_price\b/
      );
    });

    it('refuses a negative price', async () => {
      await expect(
        settle({
          pricePaidCents: -1,
          pricePaidCurrency: 'EUR',
          priceScopeId: SCOPE,
        })
      ).rejects.toThrow(/ck_line_settlements_price_amount/);
    });

    // Nothing was paid for a thing nobody got.
    it('refuses a price on a close', async () => {
      await expect(
        settle({
          outcome: 'NOT_AVAILABLE',
          pricePaidCents: 129,
          pricePaidCurrency: 'EUR',
          priceScopeId: SCOPE,
        })
      ).rejects.toThrow(/ck_line_settlements_price_bought/);
    });

    // A close keeps the place: which chain had none is the half of that outcome
    // worth keeping.
    it('accepts a close that keeps its scope and its shop', async () => {
      await expect(
        settle({
          outcome: 'NOT_AVAILABLE',
          priceScopeId: SCOPE,
          supermarketLocationId: SHOP,
        })
      ).resolves.toBeDefined();
    });

    it('refuses a shop with no scope', async () => {
      await expect(settle({ supermarketLocationId: SHOP })).rejects.toThrow(
        /ck_line_settlements_location_scope/
      );
    });
  });

  describe('down and up again, on a table that holds settlements (test 16)', () => {
    it('drops the price it recorded and can be applied again', async () => {
      await settle({
        pricePaidCents: 129,
        pricePaidCurrency: 'EUR',
        priceScopeId: SCOPE,
        supermarketLocationId: SHOP,
      });
      await settle({ outcome: 'NOT_AVAILABLE', priceScopeId: SCOPE });

      await probe.undoLastMigration({ transaction: 'each' });

      // Lossy for every price this plan recorded, and the rows themselves
      // stand: a purchase is not undone by a schema going backwards.
      const reverted: { pricePaidCents: number | null }[] = await probe.query(
        `SELECT "pricePaidCents" FROM "line_settlements"`
      );
      expect(reverted).toHaveLength(2);
      expect(reverted.every((row) => row.pricePaidCents === null)).toBe(true);
      await expect(
        probe.query(`SELECT "pricePaidCurrency" FROM "line_settlements"`)
      ).rejects.toThrow(/pricePaidCurrency/);

      // The half the plan's first draft got wrong: an amount left with no
      // currency fails `ck_line_settlements_price` here, and a migration that
      // cannot be re-applied is not reversible.
      await expect(
        probe.runMigrations({ transaction: 'each' })
      ).resolves.toBeDefined();

      const reapplied: { count: string }[] = await probe.query(
        `SELECT COUNT(*)::text AS count FROM "line_settlements"
          WHERE "pricePaidCurrency" IS NULL AND "priceScopeId" IS NULL`
      );
      expect(reapplied[0].count).toBe('2');
    }, 300_000);
  });
});
