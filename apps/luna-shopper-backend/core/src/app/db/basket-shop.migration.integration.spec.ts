import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { SettlementChain1756003500000 } from './migrations/1756003500000-SettlementChain';

/**
 * The shop a basket is bought at, and the chain a settle records (plan 0163,
 * sections 1 and 5).
 *
 * Against a probe database of its own, as plan 0143's migration spec is and
 * for the same reason: the claims are about tables with and without the new
 * columns, which cannot both be true of the database the other suites share.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=basket-shop.migration.integration.spec.ts
 *
 * What it proves:
 *
 * - `ck_baskets_live_no_shop` refuses a shop on a `LIVE` basket and nothing
 *   else: a trip may carry one.
 * - `ck_line_settlements_location_scope` now refuses a chain without its shop,
 *   and still refuses a shop without its scope.
 * - Both `down`s and the `up`s again run on tables that **hold** a basket with
 *   a shop and a settlement with a chain.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(SettlementChain1756003500000) + 1
);

const PROBE_DATABASE = 'luna_core_0163_probe';

const ZONE = '01630163-0000-4000-a000-00000000000a';
const LIST = '01630163-0000-4000-a000-00000000000b';
const LINE = '01630163-0000-4000-a000-00000000000c';
const OWNER = '01630163-0000-4000-a000-00000000000d';
const OTHER_OWNER = '01630163-0000-4000-a000-00000000000e';
/** A scope, a shop and its chain, all opaque to core. */
const SCOPE = '01630163-1111-4000-a000-000000000001';
const SHOP = '01630163-1111-4000-a000-000000000002';
const CHAIN = '01630163-1111-4000-a000-000000000003';

describeIntegration('BasketShop and SettlementChain (real Postgres)', () => {
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

  /** One basket of `kind`, with or without a shop. */
  function basket(
    kind: 'GENERATED' | 'LIVE',
    supermarketLocationId: string | null,
    ownerUserId = OWNER
  ): Promise<unknown> {
    return probe.query(
      `INSERT INTO "baskets"
         ("ownerUserId", "kind", "name", "status", "generatedAt",
          "supermarketLocationId")
       VALUES ($1, $2, NULL, 'OPEN', now(), $3)`,
      [ownerUserId, kind, supermarketLocationId]
    );
  }

  /** One settlement, with whichever of the place columns are given. */
  function settle(
    columns: {
      priceScopeId?: string | null;
      supermarketLocationId?: string | null;
      supermarketId?: string | null;
    } = {}
  ): Promise<unknown> {
    return probe.query(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "itemId", "outcome", "quantity",
          "settledByUserId", "settledAt",
          "priceScopeId", "supermarketLocationId", "supermarketId")
       VALUES ($1, $2, NULL, 'BOUGHT', 1, $3, now(), $4, $5, $6)`,
      [
        LINE,
        LIST,
        OWNER,
        columns.priceScopeId ?? null,
        columns.supermarketLocationId ?? null,
        columns.supermarketId ?? null,
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
       VALUES ($1, 'Home', 'P0163P0163P0163', 'ACTIVE', '{}'::jsonb)`,
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
    await probe.query(`DELETE FROM "baskets"`);
  });

  describe('the basket shop (section 1)', () => {
    it('accepts a shop on a trip, and a trip with none', async () => {
      await expect(basket('GENERATED', SHOP)).resolves.toBeDefined();
      await expect(basket('GENERATED', null)).resolves.toBeDefined();
    });

    it('accepts the permanent basket with no shop', async () => {
      await expect(basket('LIVE', null)).resolves.toBeDefined();
    });

    // The permanent basket's shop is a choice of the device, never of the
    // basket, so it has no column to hold one.
    it('refuses a shop on the permanent basket', async () => {
      await expect(basket('LIVE', SHOP, OTHER_OWNER)).rejects.toThrow(
        /ck_baskets_live_no_shop/
      );
    });
  });

  describe('the settlement chain (section 5)', () => {
    it('accepts a shop with its chain and its scope', async () => {
      await expect(
        settle({
          priceScopeId: SCOPE,
          supermarketLocationId: SHOP,
          supermarketId: CHAIN,
        })
      ).resolves.toBeDefined();
    });

    // Any shop mode: the scope of the price shown, and no place.
    it('accepts a scope with neither a shop nor a chain', async () => {
      await expect(settle({ priceScopeId: SCOPE })).resolves.toBeDefined();
    });

    it('refuses a chain without its shop', async () => {
      await expect(
        settle({ priceScopeId: SCOPE, supermarketId: CHAIN })
      ).rejects.toThrow(/ck_line_settlements_location_scope/);
    });

    it('still refuses a shop without its scope', async () => {
      await expect(
        settle({ supermarketLocationId: SHOP, supermarketId: CHAIN })
      ).rejects.toThrow(/ck_line_settlements_location_scope/);
    });
  });

  describe('down and up again, on tables that hold what the plan records', () => {
    it('reverts both migrations and applies them again', async () => {
      await basket('GENERATED', SHOP);
      await settle({
        priceScopeId: SCOPE,
        supermarketLocationId: SHOP,
        supermarketId: CHAIN,
      });

      await probe.undoLastMigration({ transaction: 'each' });
      await probe.undoLastMigration({ transaction: 'each' });

      // The rows stand; only the two columns went.
      await expect(
        probe.query(`SELECT "supermarketId" FROM "line_settlements"`)
      ).rejects.toThrow(/supermarketId/);
      await expect(
        probe.query(`SELECT "supermarketLocationId" FROM "baskets"`)
      ).rejects.toThrow(/supermarketLocationId/);
      const kept: { supermarketLocationId: string }[] = await probe.query(
        `SELECT "supermarketLocationId" FROM "line_settlements"`
      );
      expect(kept).toEqual([{ supermarketLocationId: SHOP }]);

      await expect(
        probe.runMigrations({ transaction: 'each' })
      ).resolves.toHaveLength(2);

      const reapplied: { basketShop: string | null; chain: string | null }[] =
        await probe.query(
          `SELECT (SELECT "supermarketLocationId" FROM "baskets" LIMIT 1) AS "basketShop",
                  (SELECT "supermarketId" FROM "line_settlements" LIMIT 1) AS "chain"`
        );
      // Not backfilled: the columns come back empty on the rows that were there.
      expect(reapplied).toEqual([{ basketShop: null, chain: null }]);
    }, 300_000);
  });
});
