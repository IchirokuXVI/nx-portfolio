import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { CORE_MIGRATIONS } from './migrations';
import { GeneratedListsBecomeBaskets1756003200000 } from './migrations/1756003200000-GeneratedListsBecomeBaskets';

/**
 * A generated list is called a basket, in the database too (plan 0144,
 * section 13, test 1).
 *
 * The claim is about a rename, which cannot be seen on a database that already
 * has it, so this runs against a probe database of its own, exactly as plan
 * 0135's migration spec does:
 *
 *   docker run -d --name tmp-pg-core -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=core -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://postgres:pw@localhost:45991/core \
 *     npx nx run luna-shopper-backend-core:test-integration
 *
 * What it proves:
 *
 * - `up` leaves nothing in `pg_class`, `pg_constraint` or `pg_type` spelling
 *   `generated`, which is section 3's own acceptance test, written as the three
 *   catalog queries it names.
 * - Every row seeded before the rename is still readable through the renamed
 *   tables afterwards, with the participant and the link still pointing at
 *   their basket. A rename moves no data, and this is what says so.
 * - `down` restores every name, and `up` runs again afterwards, which
 *   `migrations.spec.ts` needs of every migration and which the rollback of
 *   section 11 depends on.
 *
 * `generatedAt` is expected to survive, and one case below says so on purpose:
 * section 1 renames the words `generated list`, and that column says neither.
 */

/**
 * The list up to and including the one under test, and the same list one short.
 *
 * Prefixes rather than the whole list with one entry taken out, for the reason
 * plan 0134's spec gives: the one under test has to be the last applied, or
 * `undoLastMigration` means a different migration.
 */
const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(GeneratedListsBecomeBaskets1756003200000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0144_probe';

const OWNER = '01440144-0000-4000-a000-00000000000a';
const BASKET = '01440144-0000-4000-a000-00000000000b';
const LINK = '01440144-0000-4000-a000-00000000000c';
const OWNER_PARTICIPANT = '01440144-0000-4000-a000-00000000000e';
const PARTICIPANT = '01440144-0000-4000-a000-00000000000d';

describeIntegration(
  'GeneratedListsBecomeBaskets1756003200000 (real Postgres)',
  () => {
    let admin: DataSource;
    let probe: DataSource;
    let probeUrl: string;

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

    /** Section 3's three catalog queries, as one count. */
    async function stillSpellingGenerated(): Promise<{
      relations: string[];
      constraints: string[];
      types: string[];
    }> {
      const relations = await probe.query(
        `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname LIKE '%generated%'
        ORDER BY c.relname`
      );
      const constraints = await probe.query(
        `SELECT conname FROM pg_constraint WHERE conname LIKE '%generated%'
        ORDER BY conname`
      );
      const types = await probe.query(
        `SELECT typname FROM pg_type WHERE typname LIKE '%generated%'
        ORDER BY typname`
      );
      return {
        relations: relations.map((r: { relname: string }) => r.relname),
        constraints: constraints.map((r: { conname: string }) => r.conname),
        types: types.map((r: { typname: string }) => r.typname),
      };
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

      // A basket, its owner, a link they made over it and somebody who joined by
      // that link, all under the names plan 0050 and plan 0051 gave them.
      //
      // The owner goes in before the link, because `createdByParticipantId` names
      // them, and the guest carries an `expiresAt` where the owner carries none:
      // that is `ck_generated_list_participants_expiry`, which plan 0140 wrote as
      // "keeping access means being added by name".
      await probe.query(
        `INSERT INTO "generated_lists"
         ("id", "ownerUserId", "name", "kind", "status", "generatedAt")
       VALUES ($1, $2, 'Saturday', 'GENERATED', 'OPEN', now())`,
        [BASKET, OWNER]
      );
      await probe.query(
        `INSERT INTO "generated_list_participants"
         ("id", "generatedListId", "kind", "userId", "joinedAt", "lastSeenAt")
       VALUES ($1, $2, 'OWNER', $3, now(), now())`,
        [OWNER_PARTICIPANT, BASKET, OWNER]
      );
      await probe.query(
        `INSERT INTO "generated_list_share_links"
         ("id", "generatedListId", "secret", "createdByParticipantId",
          "expiresAt")
       VALUES ($1, $2, 'sssssssssssssssssssssss0144', $3,
               now() + interval '12 hours')`,
        [LINK, BASKET, OWNER_PARTICIPANT]
      );
      await probe.query(
        `INSERT INTO "generated_list_participants"
         ("id", "generatedListId", "kind", "shareLinkId", "guestNumber",
          "joinedAt", "lastSeenAt", "expiresAt")
       VALUES ($1, $2, 'GUEST', $3, 1, now(), now(),
               now() + interval '12 hours')`,
        [PARTICIPANT, BASKET, LINK]
      );
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

    it('renames the three tables and leaves every row readable', async () => {
      await open(THROUGH);
      await probe.runMigrations({ transaction: 'all' });

      const [basket] = await probe.query(
        `SELECT "id", "ownerUserId", "name", "kind", "status" FROM "baskets"`
      );
      expect(basket).toEqual({
        id: BASKET,
        ownerUserId: OWNER,
        name: 'Saturday',
        kind: 'GENERATED',
        status: 'OPEN',
      });

      // The column is `basketId` on both children, and both still name the basket
      // they named before: a rename moves nothing.
      const [link] = await probe.query(
        `SELECT "id", "basketId" FROM "basket_share_links"`
      );
      expect(link).toEqual({ id: LINK, basketId: BASKET });

      const [participant] = await probe.query(
        `SELECT "id", "basketId", "shareLinkId" FROM "basket_participants"
        WHERE "id" = $1`,
        [PARTICIPANT]
      );
      expect(participant).toEqual({
        id: PARTICIPANT,
        basketId: BASKET,
        shareLinkId: LINK,
      });
    });

    it('leaves no table, index, constraint or type spelling the old name', async () => {
      expect(await stillSpellingGenerated()).toEqual({
        relations: [],
        constraints: [],
        types: [],
      });
    });

    it('keeps `generatedAt`, which never said the word', async () => {
      // Section 1 renames `generated list`. This column is the moment the basket
      // was made, and `createdAt`, the obvious new name, is what `BaseEntity`
      // already gives every row in core.
      const columns = await probe.query(
        `SELECT "column_name" FROM information_schema.columns
        WHERE "table_schema" = 'public' AND "table_name" = 'baskets'
          AND "column_name" IN ('generatedAt', 'createdAt')
        ORDER BY "column_name"`
      );
      expect(
        columns.map((c: { column_name: string }) => c.column_name)
      ).toEqual(['createdAt', 'generatedAt']);
    });

    it('restores every name on down, and runs up again', async () => {
      await probe.undoLastMigration({ transaction: 'all' });

      const back = await stillSpellingGenerated();
      expect(back.relations).toEqual(
        expect.arrayContaining([
          'generated_lists',
          'generated_list_participants',
          'generated_list_share_links',
          'ix_generated_lists_owner',
          'pk_generated_lists',
          'uq_generated_list_share_links_secret',
        ])
      );
      expect(back.constraints).toEqual(
        expect.arrayContaining([
          'fk_generated_list_participants_list',
          'fk_generated_list_share_links_list',
          'ck_generated_lists_live_shape',
        ])
      );

      // The rows are still there under the old names, which is what makes the
      // rollback of section 11 safe.
      const [row] = await probe.query(
        `SELECT "generatedListId" FROM "generated_list_participants"
        WHERE "id" = $1`,
        [PARTICIPANT]
      );
      expect(row).toEqual({ generatedListId: BASKET });

      await probe.runMigrations({ transaction: 'all' });
      expect(await stillSpellingGenerated()).toEqual({
        relations: [],
        constraints: [],
        types: [],
      });
    });
  }
);
