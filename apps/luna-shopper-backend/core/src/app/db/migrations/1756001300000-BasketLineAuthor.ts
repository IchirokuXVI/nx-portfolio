import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record who put a line in a basket (plan 0055, section 4).
 *
 * One nullable column and nothing else. Plan 0055 section 3 lets any live
 * participant add a line, guests included, and the moment that is possible the
 * basket needs to be able to say where a line nobody recognises came from.
 *
 * ## Why not reuse `lastEditedByParticipantId`
 *
 * Because the two answer different questions and that one moves. It is written
 * by every edge and every settle, so the first person to tick a line off
 * becomes its `lastEditedBy` and the fact that somebody else typed it is gone.
 * "Who put this on the list" is the question a shop full of people actually
 * asks, and it needs a column that is written once.
 *
 * ## No backfill, and none is needed
 *
 * Null here means the run created the line, which is true of every existing
 * row: before this plan the only way a line reached a basket was the generation
 * or the owner's own account surface, and a `DERIVED` line was put there by the
 * generation rather than by a person. The person who ran it is the owner, who is
 * already named on the basket.
 *
 * ## No foreign key
 *
 * The same decision, and the same reason, as `settledByParticipantId` in plan
 * 0051's migration: participants are revoked and baskets are deleted, and a
 * line's authorship should not be what keeps a participant row alive or what
 * fails a delete. The id is resolved against the participant list the basket
 * read already carries, and a line whose author has been revoked simply renders
 * without a name.
 */
export class BasketLineAuthor1756001300000 implements MigrationInterface {
  name = 'BasketLineAuthor1756001300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_list_lines"
        ADD COLUMN "createdByParticipantId" uuid
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_lines"."createdByParticipantId" IS
        'Who put this line in the basket, written once and never afterwards (plan 0055, section 4). Null means the run composed it, which is true of every row written before that plan. Kept apart from "lastEditedByParticipantId", which moves the moment anybody settles or edits the line. No foreign key: participants are revoked and baskets are deleted, and neither should be held up by a line remembering who typed it.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_list_lines"
        DROP COLUMN "createdByParticipantId"
    `);
  }
}
