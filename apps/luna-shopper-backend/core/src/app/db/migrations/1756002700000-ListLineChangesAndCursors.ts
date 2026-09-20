import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What changed on a list, and what each viewer has seen of it (plan 0138,
 * section 11).
 *
 * Two new tables and nothing else. No column moves, no backfill and no existing
 * constraint touched.
 *
 * ## There is deliberately no backfill
 *
 * Nothing recorded a change before this migration. `list_lines.version` counts
 * writes without saying what any of them did, so rows invented from it would be a
 * history nobody can vouch for, shown to a shopper as "this changed while you
 * were away".
 *
 * ## `kind` is a `varchar` with a check, not an enum
 *
 * `core/src/migrate.ts` runs every pending migration in **one** transaction, and
 * a Postgres enum value created inside a transaction cannot be used in it. So a
 * later migration that added a kind and wrote a row of it would fail on the
 * cluster and pass locally. `generated_list_participants.endedReason` already set
 * this precedent for the same reason.
 *
 * ## Which keys cascade, and which are not keys at all
 *
 * `listId` cascades: a deleted list leaves every basket's coverage, so nothing
 * can read its changes again. `lineId` and `mergedIntoLineId` carry **no** key,
 * because a merge deletes the absorbed row for real and the change that says so
 * has to outlive it. The two actor columns and `basketId` carry none either: a
 * change is a fact about a list, and it outlives the basket it was made from and
 * the account that made it.
 */
export class ListLineChangesAndCursors1756002700000 implements MigrationInterface {
  name = 'ListLineChangesAndCursors1756002700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "list_line_changes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "zoneId" uuid NOT NULL,
        "listId" uuid NOT NULL,
        "lineId" uuid NOT NULL,
        "kind" varchar NOT NULL,
        "contentBefore" varchar,
        "contentAfter" varchar,
        "quantityBefore" int,
        "quantityAfter" int,
        "approvalBefore" varchar,
        "approvalAfter" varchar,
        "mergedIntoLineId" uuid,
        "actorUserId" uuid,
        "actorParticipantId" uuid,
        "basketId" uuid,
        CONSTRAINT "pk_list_line_changes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_list_line_changes_list" FOREIGN KEY ("listId")
          REFERENCES "shopping_lists" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_list_line_changes_kind" CHECK (
          "kind" IN (
            'ADDED','QUANTITY_CHANGED','RENAMED','MERGED','DELETED','APPROVAL_CHANGED'
          )
        ),
        CONSTRAINT "ck_list_line_changes_merged" CHECK (
          ("kind" = 'MERGED') = ("mergedIntoLineId" IS NOT NULL)
        ),
        CONSTRAINT "ck_list_line_changes_basket_actor" CHECK (
          "actorParticipantId" IS NULL OR "basketId" IS NOT NULL
        )
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "list_line_changes" IS
        'One change to what a list asks for (plan 0138). Keyed by the list, so one row serves every basket that covers it. Swept after LIST_LINE_CHANGE_RETENTION.'
    `);
    // Every read is "the changes of these lists, newest first, since a moment",
    // so the index is the list, the time and the id tie break in that order.
    await queryRunner.query(`
      CREATE INDEX "ix_list_line_changes_list"
        ON "list_line_changes" ("listId", "createdAt", "id")
    `);
    // The retention sweep, which walks the oldest rows of the whole table
    // regardless of list.
    await queryRunner.query(`
      CREATE INDEX "ix_list_line_changes_created"
        ON "list_line_changes" ("createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "basket_change_cursors" (
        "participantId" uuid NOT NULL,
        "seenFrom" timestamptz NOT NULL,
        "seenThrough" timestamptz NOT NULL,
        "ackedAt" timestamptz NOT NULL,
        CONSTRAINT "pk_basket_change_cursors" PRIMARY KEY ("participantId"),
        CONSTRAINT "fk_basket_change_cursors_participant"
          FOREIGN KEY ("participantId")
          REFERENCES "generated_list_participants" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_basket_change_cursors_order" CHECK (
          "seenFrom" <= "seenThrough"
        )
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "basket_change_cursors" IS
        'What one participant has seen of the changes to their basket''s lists (plan 0138). The viewer is a participant, so two phones of one account share a cursor.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Lossy by nature and harmless: every mark and every change row goes, and no
    // list, line or basket is touched. The schema below this migration has
    // nowhere to keep either.
    await queryRunner.query(`DROP TABLE IF EXISTS "basket_change_cursors"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_list_line_changes_created"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_list_line_changes_list"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "list_line_changes"`);
  }
}
