import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen plan 0047's `line_settlements` so a guest can settle (plan 0051,
 * sections 3.3 and 10).
 *
 * Plan 0047 section 3.3 named this migration in advance and said it belongs
 * here, so the shape is not a surprise: that plan made `settledByUserId` non
 * nullable because without baskets the only people who can settle are account
 * holders with access to the list, and this plan introduces people who settle and
 * are not users.
 *
 * ## Exactly one, enforced by the database
 *
 * `ck_line_settlements_actor` is the point of the migration. A settlement is
 * attributed to a person, and after this there are two kinds of person it can be
 * attributed to, so the one thing that must never happen is a row attributed to
 * both or to neither. That is a check constraint rather than a service rule
 * because it is an invariant about the row rather than about any particular way
 * of writing one, and because a row with neither would be an unattributable
 * purchase in a shared household's history, which is the failure this table
 * exists to prevent.
 *
 * ## Which column a basket settle writes
 *
 * The participant one, **always**, including when the person settling is the
 * owner with a perfectly good account. Every actor on a basket is a participant
 * (section 3.2), so attributing some basket settles to a user and others to a
 * participant would make "who got the bread" two questions instead of one. A
 * settle straight from the list page (plan 0047, section 4.4) still writes the
 * user column and no participant, which is the other half of the constraint.
 *
 * ## Backfill
 *
 * None, and none is needed: every existing row has a `settledByUserId` and a null
 * participant, which already satisfies the constraint. Adding the column nullable
 * and the constraint afterwards is therefore safe on a populated table, and the
 * `NOT NULL` drop is what makes the new half possible without touching the old.
 */
export class SettlementParticipants1756001200000 implements MigrationInterface {
  name = 'SettlementParticipants1756001200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ALTER COLUMN "settledByUserId" DROP NOT NULL,
        ADD COLUMN "settledByParticipantId" uuid
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."settledByParticipantId" IS
        'Who settled it, when it was settled from a shared basket (plan 0051, section 6). Always the participant and never the user on that path, including for the owner, so that "who got the bread" is one question rather than two. No foreign key: a basket and its participants can be deleted while the settlement, which is a zone fact rather than a basket one, stays.'
    `);
    // The invariant the whole migration is for. Named rather than anonymous so a
    // violation says which rule was broken.
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_actor" CHECK (
          ("settledByUserId" IS NOT NULL AND "settledByParticipantId" IS NULL)
          OR ("settledByUserId" IS NULL AND "settledByParticipantId" IS NOT NULL)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_settlements_participant"
        ON "line_settlements" ("settledByParticipantId")
        WHERE "settledByParticipantId" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_settlements_participant"`);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_actor"
    `);
    // A row attributed to a participant has no user to fall back on, so going
    // back means those rows cannot exist. Deleting them is the honest reverse:
    // the alternative is inventing an account to blame a purchase on.
    await queryRunner.query(`
      DELETE FROM "line_settlements" WHERE "settledByUserId" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP COLUMN "settledByParticipantId",
        ALTER COLUMN "settledByUserId" SET NOT NULL
    `);
  }
}
