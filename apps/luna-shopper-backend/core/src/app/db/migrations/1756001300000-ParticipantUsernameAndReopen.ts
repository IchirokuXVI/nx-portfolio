import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A participant carries a username, and a settlement can be taken back (plan
 * 0054, sections 2, 3.3 and 5).
 *
 * Three changes, all additive, none rewriting a row. They are in one migration
 * because they ship together and neither half is useful alone, not because they
 * are one idea: section 2 and section 3 of that plan are independent.
 *
 * ## The username is a column and not a value written into `displayName`
 *
 * They are different facts. `displayName` is what somebody typed on an
 * unauthenticated link, and this is an account's own name, so merging them would
 * make a guest's typed "Dani" indistinguishable on the wire from an account
 * called Dani, which is the distinction plan 0051 section 3.5 rests on. The
 * length cap matches `displayName`'s, since both end up in the same place on the
 * same screen.
 *
 * No backfill, and the plan is explicit about why: core owns no usernames and
 * may not reach into auth for one (plan 0018, section 9), so a name can only
 * arrive on a message from the gateway. Existing rows stay null until the next
 * share or join carries one, which is the same lazy repair plan 0051 chose for
 * the owner's row existing at all.
 *
 * ## A reopen marks a settlement rather than deleting it
 *
 * `revertedAt` is the whole of section 3.3. A settlement is an append (plan
 * 0047, section 3), so taking one back writes a timestamp: the row is excluded
 * from every consumption total and is still served by the settlement history,
 * marked, because "somebody said they got this and then took it back" is a truer
 * history than a gap.
 *
 * The alternative, appending a compensating settlement with a negative quantity,
 * was rejected for keeping the ledger append only at the cost of making every
 * existing sum over `quantity` wrong until it was taught about signs. There are
 * such sums in the line indicators, in the item history and in reconciliation,
 * and a nullable timestamp changes each of them by one `WHERE` clause.
 *
 * `ck_line_settlements_revert` is the shape `ck_line_settlements_actor` already
 * carries, applied to the pair this adds: a reverted row names who reverted it,
 * and a standing row names nobody. A timestamp with no actor would be an
 * unattributable reversal in the same history the actor constraint exists to
 * keep attributable.
 *
 * ## Why the partial index
 *
 * Every total this plan touches gains `WHERE "revertedAt" IS NULL`, and the
 * reopen itself reads one basket line's live settlements. Both are answered off
 * `("generatedListLineId") WHERE "revertedAt" IS NULL`, so the exclusion costs
 * an index lookup rather than a scan of a table that will be the largest in
 * core.
 */
export class ParticipantUsernameAndReopen1756001300000 implements MigrationInterface {
  name = 'ParticipantUsernameAndReopen1756001300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD COLUMN "username" varchar(40)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."username" IS
        'The account holder''s own name, for an OWNER or REGISTERED row (plan 0054, section 2). Written from what the gateway was told and never read out of auth, since core owns no usernames. Separate from "displayName", which is unverified text typed on an unauthenticated link. A snapshot taken at join time, as a zone membership''s is.'
    `);

    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD COLUMN "revertedAt" timestamptz,
        ADD COLUMN "revertedByParticipantId" uuid
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."revertedAt" IS
        'When somebody took this settlement back (plan 0054, section 3.3). A reopen marks the row rather than deleting it: it is excluded from every consumption total and still served by the settlement history, marked.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."revertedByParticipantId" IS
        'Who took it back. A participant always, never a user, for the reason "settledByParticipantId" is: a reopen happens on a basket, where every actor is a participant. No foreign key, so the settlement outlives the basket.'
    `);
    // Both or neither, named rather than anonymous so a violation says which
    // rule was broken. A timestamp with no actor would be an unattributable
    // reversal in a shared household's history.
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_revert" CHECK (
          ("revertedAt" IS NULL AND "revertedByParticipantId" IS NULL)
          OR ("revertedAt" IS NOT NULL AND "revertedByParticipantId" IS NOT NULL)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_settlements_basket_line_live"
        ON "line_settlements" ("generatedListLineId")
        WHERE "revertedAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_settlements_basket_line_live"`);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_revert"
    `);
    // Dropping the columns is the whole reverse, and it is lossy in one honest
    // direction: a reverted settlement becomes a standing one again, so a
    // household that took a purchase back would find it counted. There is
    // nowhere else to put that fact in the earlier schema, and inventing a
    // deletion to hide it would be worse than counting it.
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP COLUMN "revertedByParticipantId",
        DROP COLUMN "revertedAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants" DROP COLUMN "username"
    `);
  }
}
