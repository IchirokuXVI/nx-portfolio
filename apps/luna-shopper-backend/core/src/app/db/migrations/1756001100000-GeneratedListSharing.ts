import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Share links, participants and the two attribution columns (plan 0051,
 * section 10).
 *
 * Append only, and it touches plan 0050's tables in exactly one place: two
 * nullable columns on `generated_list_lines`, which is what section 8 asks for
 * and the whole cost of sharing to the tables that already existed.
 *
 * The migration that widens plan 0047's `line_settlements` is a **separate** one,
 * because that table belongs to a plan that lands independently and a migration
 * that alters a table it did not create should not also be the migration that
 * creates two of its own.
 *
 * ## The three indexes that carry rules
 *
 * `uq_generated_list_share_links_live` is a **partial** unique index over
 * `generatedListId` where `revokedAt` is null. It is the whole of section 3's
 * "a generated list has zero share links or one": pressing share twice is
 * idempotent by the database rather than by a service check that would need a
 * lock to be right, and revoked rows stay, so the index is partial rather than
 * the table holding one row per basket forever.
 *
 * `uq_generated_list_participants_user` is partial over (`generatedListId`,
 * `userId`) where the user is not null. It is what makes a registered person
 * opening a second link resolve to the participant row they already have
 * (section 4, step 3), while leaving any number of guests, who have no user id,
 * on the same basket. Postgres treats nulls as distinct in a unique index, which
 * here is exactly the behaviour wanted rather than the trap it was in plan 0049.
 *
 * `uq_generated_list_participants_secret` is partial over `sessionSecretHash`
 * where it is not null, and it is the **hot path**: section 3.3 specifies that
 * authorizing a guest request is one indexed lookup on this column, reading
 * `revokedAt` on the row it finds, with no cache, because revocation has to bite
 * immediately.
 *
 * ## What is deliberately not here
 *
 * No foreign key on `userId`, opaque across the auth boundary as everywhere else
 * in core, and none on `createdByParticipantId` or `lastEditedByParticipantId`
 * either. Both name a participant of the same basket and both would be cycles
 * through tables that cascade from `generated_lists` anyway: deleting a basket
 * takes its links, its participants and its lines together, so a constraint
 * between them would only decide the order of a delete that has one correct
 * order already.
 *
 * `secret` is `varchar(64)` and **not hashed**, which is the asymmetry
 * section 3.1 argues: a participant's session secret is a credential and is
 * hashed beside it in the same table, while a link secret is an invitation the
 * owner must be able to copy again tomorrow, from another device, for the next
 * person.
 */
export class GeneratedListSharing1756001100000 implements MigrationInterface {
  name = 'GeneratedListSharing1756001100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "participant_kind" AS ENUM ('OWNER', 'REGISTERED', 'GUEST')
    `);

    await queryRunner.query(`
      CREATE TABLE "generated_list_share_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListId" uuid NOT NULL,
        "secret" varchar(64) NOT NULL,
        "createdByParticipantId" uuid NOT NULL,
        "expiresAt" timestamptz,
        "revokedAt" timestamptz,
        CONSTRAINT "pk_generated_list_share_links" PRIMARY KEY ("id"),
        CONSTRAINT "fk_generated_list_share_links_list" FOREIGN KEY ("generatedListId")
          REFERENCES "generated_lists" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_share_links"."secret" IS
        'The invitation itself, stored retrievably rather than hashed (plan 0051, section 3.1). The owner has to be able to copy it again tomorrow, from another device, for the next person, so the share sheet returns it on every read. The cost is named in the plan: a database leak hands over working invitations, and no participant session.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_share_links"."revokedAt" IS
        'Never consulted on the hot path (plan 0051, section 3.3). Authorizing a participant reads revokedAt on the participant row alone, which is what lets section 3.4 stop a link spreading without evicting the people already in the shop.'
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_generated_list_share_links_secret" ON "generated_list_share_links" ("secret")`
    );
    // Section 3: a basket has zero live links or one. Partial, so the revoked
    // rows the participants point back at can stay.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_generated_list_share_links_live"
        ON "generated_list_share_links" ("generatedListId")
        WHERE "revokedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "generated_list_participants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "generatedListId" uuid NOT NULL,
        "shareLinkId" uuid,
        "kind" "participant_kind" NOT NULL,
        "userId" uuid,
        "displayName" varchar(40),
        "guestNumber" integer,
        "sessionSecretHash" varchar(64),
        "userAgent" varchar(400),
        "joinedAt" timestamptz NOT NULL DEFAULT now(),
        "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
        "revokedAt" timestamptz,
        CONSTRAINT "pk_generated_list_participants" PRIMARY KEY ("id"),
        CONSTRAINT "fk_generated_list_participants_list" FOREIGN KEY ("generatedListId")
          REFERENCES "generated_lists" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_generated_list_participants_link" FOREIGN KEY ("shareLinkId")
          REFERENCES "generated_list_share_links" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."displayName" IS
        'What a guest typed, and unverified text on an unauthenticated link (plan 0051, section 3.5). It is what the screen shows and never what a record keeps: two guests can both type "Dani", and the participant id is what distinguishes them.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."sessionSecretHash" IS
        'A guest credential, stored hashed like a password (plan 0051, section 3.1). Null for OWNER and REGISTERED, who authenticate with an account token: a participant who can prove who they are by other means does not get a password.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."userAgent" IS
        'Captured at join and not presence data (plan 0051, section 7): shown on tap, to participants who pass section 5.2 only. Guests do not get to inspect each other.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_participants_list" ON "generated_list_participants" ("generatedListId", "joinedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_generated_list_participants_link" ON "generated_list_participants" ("shareLinkId")`
    );
    // Section 4, step 3: however many links a registered person opens, they are
    // the same participant. Partial, because guests carry no user id and any
    // number of them belong on one basket.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_generated_list_participants_user"
        ON "generated_list_participants" ("generatedListId", "userId")
        WHERE "userId" IS NOT NULL
    `);
    // Section 3.3's one indexed lookup, which is every participant authenticated
    // request a guest makes.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_generated_list_participants_secret"
        ON "generated_list_participants" ("sessionSecretHash")
        WHERE "sessionSecretHash" IS NOT NULL
    `);

    // Section 8: who touched this line last, read on every row of the main
    // screen, which is why it is a column here rather than a join into an event
    // log.
    await queryRunner.query(`
      ALTER TABLE "generated_list_lines"
        ADD COLUMN "lastEditedByParticipantId" uuid,
        ADD COLUMN "lastEditedAt" timestamptz
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_lines"."lastEditedByParticipantId" IS
        'Who touched this line last, written by every edit and every settle (plan 0051, section 8). A participant rather than a user, because a guest has no user id and the owner has a participant row from generation time precisely so this can be one column.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The columns first, then the participants that reference the links, then the
    // links, then the type nothing uses any more.
    await queryRunner.query(`
      ALTER TABLE "generated_list_lines"
        DROP COLUMN "lastEditedAt",
        DROP COLUMN "lastEditedByParticipantId"
    `);
    await queryRunner.query(`DROP TABLE "generated_list_participants"`);
    await queryRunner.query(`DROP TABLE "generated_list_share_links"`);
    await queryRunner.query(`DROP TYPE "participant_kind"`);
  }
}
