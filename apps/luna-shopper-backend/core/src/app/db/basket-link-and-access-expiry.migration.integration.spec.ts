import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { BasketLinkAndAccessExpiry1756002800000 } from './migrations/1756002800000-BasketLinkAndAccessExpiry';

/**
 * A link that lasts twelve hours, and the backfill that gives one to everybody
 * already on a basket (plan 0140, section 9, test 1).
 *
 * The claim is about the state **before** the migration, which cannot be reached
 * on a database that already has it, so this runs against a probe database of
 * its own, exactly as plan 0134's migration spec does:
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - A live visitor gets twelve hours from the deploy, so a trip in progress is
 *   not ended by the upgrade itself.
 * - An ended row gets its own `revokedAt`, which is when its access actually
 *   stopped, so the new constraint holds over it without inventing a future for
 *   a row that has none.
 * - The owner and a person the owner added by name stay null, which is the
 *   product owner's rule written as a check constraint.
 * - Every link becomes `createdAt + 12 hours`, which makes nearly all of them
 *   dead at the deploy. That is the intent rather than a side effect.
 * - Down restores the old shape, and says where it is lossy.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(BasketLinkAndAccessExpiry1756002800000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0140_probe';

const OWNER = '01400140-0000-4000-a000-00000000000a';
const FRIEND = '01400140-0000-4000-a000-00000000000b';
const BASKET = '01400140-0000-4000-a000-00000000000c';
const LINK = '01400140-0000-4000-a000-00000000000d';

/** The participants, by the id each is seeded under. */
const ROWS = {
  owner: '01400140-1111-4000-a000-000000000001',
  namedPerson: '01400140-1111-4000-a000-000000000002',
  liveGuest: '01400140-1111-4000-a000-000000000003',
  liveVisitor: '01400140-1111-4000-a000-000000000004',
  removedGuest: '01400140-1111-4000-a000-000000000005',
} as const;

const REVOKED_AT = '2026-01-05T09:00:00.000Z';
const LINK_CREATED_AT = '2026-01-02T08:00:00.000Z';

describeIntegration('BasketLinkAndAccessExpiry1756002800000 (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  async function expiries(): Promise<Map<string, Date | null>> {
    const rows: { id: string; expiresAt: Date | null }[] = await probe.query(
      `SELECT "id", "expiresAt" FROM "generated_list_participants"`
    );
    return new Map(rows.map((row) => [row.id, row.expiresAt]));
  }

  async function open(migrations: typeof CORE_MIGRATIONS): Promise<void> {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: CORE_ENTITIES,
      migrations,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
  }

  async function seedParticipant(
    id: string,
    columns: Record<string, unknown>
  ): Promise<void> {
    const base: Record<string, unknown> = {
      id,
      generatedListId: BASKET,
      kind: 'GUEST',
      userId: null,
      displayName: null,
      username: null,
      guestNumber: null,
      sessionSecretHash: null,
      userAgent: null,
      joinedAt: new Date('2026-01-03T10:00:00.000Z'),
      lastSeenAt: new Date('2026-01-03T10:00:00.000Z'),
      revokedAt: null,
      endedReason: null,
      invitedAt: null,
      invitedByUserId: null,
      shareLinkId: null,
      ...columns,
    };
    const keys = Object.keys(base);
    await probe.query(
      `INSERT INTO "generated_list_participants"
         (${keys.map((key) => `"${key}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((key) => base[key])
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

    await open(BEFORE);
    await probe.runMigrations({ transaction: 'each' });

    await probe.query(
      `INSERT INTO "generated_lists"
         ("id", "ownerUserId", "name", "kind", "status", "generatedAt")
       VALUES ($1, $2, 'Saturday', 'GENERATED', 'OPEN', now())`,
      [BASKET, OWNER]
    );

    await seedParticipant(ROWS.owner, { kind: 'OWNER', userId: OWNER });

    await probe.query(
      `INSERT INTO "generated_list_share_links"
         ("id", "generatedListId", "secret", "createdByParticipantId",
          "createdAt", "expiresAt", "revokedAt")
       VALUES ($1, $2, 'secret-0140', $3, $4, NULL, NULL)`,
      [LINK, BASKET, ROWS.owner, LINK_CREATED_AT]
    );

    await seedParticipant(ROWS.namedPerson, {
      kind: 'REGISTERED',
      userId: FRIEND,
      invitedAt: new Date('2026-01-04T10:00:00.000Z'),
      invitedByUserId: OWNER,
    });
    await seedParticipant(ROWS.liveGuest, {
      guestNumber: 1,
      shareLinkId: LINK,
    });
    await seedParticipant(ROWS.liveVisitor, {
      kind: 'REGISTERED',
      userId: '01400140-0000-4000-a000-00000000000e',
      shareLinkId: LINK,
    });
    await seedParticipant(ROWS.removedGuest, {
      guestNumber: 2,
      shareLinkId: LINK,
      revokedAt: REVOKED_AT,
      endedReason: 'REMOVED',
    });

    await open(THROUGH);
    await probe.runMigrations({ transaction: 'each' });
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

  it('gives a live guest twelve hours from the deploy', async () => {
    // The grace that keeps a deploy during somebody's shop from ending it.
    const expiry = (await expiries()).get(ROWS.liveGuest);
    const hoursAway = (expiry as Date).getTime() - Date.now();
    expect(hoursAway).toBeGreaterThan(11.5 * 60 * 60 * 1000);
    expect(hoursAway).toBeLessThan(12.5 * 60 * 60 * 1000);
  });

  it('gives a live signed in visitor the same twelve hours', async () => {
    // Nobody is kept: a visitor the owner meant to keep and one they forgot look
    // identical in these rows, so no intent can be recovered from them.
    expect((await expiries()).get(ROWS.liveVisitor)).not.toBeNull();
  });

  it('gives an ended row its own revokedAt, which is when its access stopped', async () => {
    expect((await expiries()).get(ROWS.removedGuest)).toEqual(
      new Date(REVOKED_AT)
    );
  });

  it('leaves the owner and a named person with no expiry at all', async () => {
    const found = await expiries();
    expect(found.get(ROWS.owner)).toBeNull();
    expect(found.get(ROWS.namedPerson)).toBeNull();
  });

  it('holds the expiry constraint against an owner given one', async () => {
    await expect(
      probe.query(
        `UPDATE "generated_list_participants"
           SET "expiresAt" = now() + interval '1 hour' WHERE "id" = $1`,
        [ROWS.owner]
      )
    ).rejects.toThrow(/ck_generated_list_participants_expiry/);
  });

  it('holds it the other way against a link visitor with none', async () => {
    await expect(
      probe.query(
        `UPDATE "generated_list_participants"
           SET "expiresAt" = NULL WHERE "id" = $1`,
        [ROWS.liveGuest]
      )
    ).rejects.toThrow(/ck_generated_list_participants_expiry/);
  });

  it('accepts EXPIRED as a reason a row ended', async () => {
    await probe.query(
      `UPDATE "generated_list_participants"
         SET "revokedAt" = now(), "endedReason" = 'EXPIRED' WHERE "id" = $1`,
      [ROWS.liveVisitor]
    );
    const [row] = await probe.query(
      `SELECT "endedReason" FROM "generated_list_participants" WHERE "id" = $1`,
      [ROWS.liveVisitor]
    );
    expect(row.endedReason).toBe('EXPIRED');

    // Put it back, so the down test below sees a row it has to rewrite.
    await probe.query(
      `UPDATE "generated_list_participants"
         SET "revokedAt" = NULL, "endedReason" = NULL WHERE "id" = $1`,
      [ROWS.liveVisitor]
    );
  });

  it('makes every link end twelve hours after it was created', async () => {
    // A link with no expiry at all was a standing key, and one with thirty days
    // was nearly one. Both become the same twelve hours, so nearly every link
    // alive at the deploy is dead at the deploy, which is the intent.
    const [row] = await probe.query(
      `SELECT "createdAt", "expiresAt" FROM "generated_list_share_links"
       WHERE "id" = $1`,
      [LINK]
    );
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
      12 * 60 * 60 * 1000
    );
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it('refuses a link whose expiry is not after its creation', async () => {
    await expect(
      probe.query(
        `UPDATE "generated_list_share_links"
           SET "expiresAt" = "createdAt" WHERE "id" = $1`,
        [LINK]
      )
    ).rejects.toThrow(/ck_generated_list_share_links_expiry/);
  });

  it('refuses a link with no expiry at all', async () => {
    await expect(
      probe.query(
        `UPDATE "generated_list_share_links" SET "expiresAt" = NULL
         WHERE "id" = $1`,
        [LINK]
      )
    ).rejects.toThrow();
  });

  describe('down', () => {
    it('restores the old shape, and rewrites EXPIRED to LEFT', async () => {
      await probe.query(
        `UPDATE "generated_list_participants"
           SET "revokedAt" = now(), "endedReason" = 'EXPIRED' WHERE "id" = $1`,
        [ROWS.liveVisitor]
      );

      await probe.undoLastMigration({ transaction: 'each' });

      const [row] = await probe.query(
        `SELECT "endedReason" FROM "generated_list_participants" WHERE "id" = $1`,
        [ROWS.liveVisitor]
      );
      // The one earlier reason that also lets the person come back by a link, so
      // a row ended by the clock keeps meaning what it meant.
      expect(row.endedReason).toBe('LEFT');

      const columns = await probe.query(
        `SELECT "column_name" FROM "information_schema"."columns"
         WHERE "table_name" = 'generated_list_participants'
           AND "column_name" = 'expiresAt'`
      );
      expect(columns).toEqual([]);

      // Lossy and stated: every visitor is permanent again, and the link's
      // nullable column is back rather than the thirty days it once held.
      const [link] = await probe.query(
        `SELECT "is_nullable" FROM "information_schema"."columns"
         WHERE "table_name" = 'generated_list_share_links'
           AND "column_name" = 'expiresAt'`
      );
      expect(link.is_nullable).toBe('YES');

      // And up again, so the suite leaves the probe where it found it.
      await probe.runMigrations({ transaction: 'each' });
    });
  });
});
