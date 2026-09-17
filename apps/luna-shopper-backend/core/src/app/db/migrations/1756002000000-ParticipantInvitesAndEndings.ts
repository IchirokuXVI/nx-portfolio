import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A participant row says how it began and how it ended (plan 0114, section 3).
 *
 * Three nullable columns on `generated_list_participants`, and nothing else
 * changes shape:
 *
 * - `invitedAt` and `invitedByUserId` are set when the owner adds a person from
 *   their groups. A live row with `invitedAt` set and `shareLinkId` null is an
 *   **invited member**, and revoking the link does not reach it, because the
 *   cascade walks `shareLinkId`.
 * - `endedReason` is `REMOVED`, `LINK_REVOKED` or `LEFT`, set together with
 *   `revokedAt`. It is what lets the link tell somebody who left, who may come
 *   back through it, from somebody the owner removed, who may not (section 7).
 *
 * ## The backfill
 *
 * Every row revoked before this plan was revoked by the owner, one person at a
 * time or through the link's cascade, and the two cannot be told apart
 * afterwards. `REMOVED` is the reading that refuses the link, which is what both
 * already meant: before this plan no revoked person could come back at all.
 *
 * ## The two constraints
 *
 * `ck_generated_list_participants_ended_reason` names the three values, and
 * `ck_generated_list_participants_ended` keeps the pair together, so a revoked
 * row always says why and a live row never carries a reason left over from the
 * last time it ended. Both are added after the backfill, which is what makes
 * them hold for the rows already there.
 *
 * ## The index
 *
 * The shared baskets read (section 8) selects one person's live rows, and the
 * unique index over (`generatedListId`, `userId`) cannot answer that, because it
 * leads with the basket. The partial index holds only the rows that read can
 * return.
 *
 * Additive throughout: `revokedAt IS NULL` stays the definition of a live
 * participant, and no existing query changes meaning.
 */
export class ParticipantInvitesAndEndings1756002000000 implements MigrationInterface {
  name = 'ParticipantInvitesAndEndings1756002000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD COLUMN "invitedAt" timestamptz NULL,
        ADD COLUMN "invitedByUserId" uuid NULL,
        ADD COLUMN "endedReason" varchar NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."invitedAt" IS
        'When the owner added this person from their groups (plan 0114, section 4). Null for a person who arrived by the link and was never added.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."invitedByUserId" IS
        'The owner who added this person. Set exactly when "invitedAt" is.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."endedReason" IS
        'Why this row stopped being live: REMOVED, LINK_REVOKED or LEFT (plan 0114, section 3). Set together with "revokedAt". Only LEFT lets the link bring the person back.'
    `);

    await queryRunner.query(`
      UPDATE "generated_list_participants"
        SET "endedReason" = 'REMOVED'
        WHERE "revokedAt" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD CONSTRAINT "ck_generated_list_participants_ended_reason" CHECK (
          "endedReason" IS NULL
          OR "endedReason" IN ('REMOVED', 'LINK_REVOKED', 'LEFT')
        ),
        ADD CONSTRAINT "ck_generated_list_participants_ended" CHECK (
          ("revokedAt" IS NULL) = ("endedReason" IS NULL)
        )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_generated_list_participants_user_live"
        ON "generated_list_participants" ("userId")
        WHERE "userId" IS NOT NULL AND "revokedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_generated_list_participants_user_live"`
    );
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        DROP CONSTRAINT IF EXISTS "ck_generated_list_participants_ended",
        DROP CONSTRAINT IF EXISTS "ck_generated_list_participants_ended_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        DROP COLUMN IF EXISTS "endedReason",
        DROP COLUMN IF EXISTS "invitedByUserId",
        DROP COLUMN IF EXISTS "invitedAt"
    `);
  }
}
