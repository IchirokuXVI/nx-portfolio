import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sharing a list with its group becomes state on the list (plan 0042, section
 * 2.1).
 *
 * `shareWithZone` was an action `create` performed once and then forgot. It
 * granted `{READ, WRITE, DECIDE}` to every member approved at that instant, and
 * nothing recorded that the list was meant to be open, so a member who joined a
 * minute later got nothing and no query could tell a list shared with a group of
 * one from a list shared with nobody. The column is what makes the intent
 * readable afterwards, which is what the approval grant needs.
 *
 * ## The backfill recovers the intent rather than guessing it
 *
 * A list was shared if it has an access row for a membership other than its
 * creator's. That row exists **only** because `shareWithZone` ran: `create` is
 * the one path that writes rows for other people without anybody opening a share
 * sheet, and a row somebody typed into the sheet is the same observable trace of
 * somebody deciding this list is theirs to use. So the statement reads a fact
 * rather than inferring one.
 *
 * The one case it cannot answer is a list in a group of one, where a shared list
 * and a private list are identical rows. It comes out false, which is also what
 * `DEFAULT false` gives a row the statement misses, and it is the case where the
 * answer does not matter yet: the first person to open the settings sheet sees
 * the switch and sets it.
 *
 * Membership rather than user, deliberately: `list_access` names a membership,
 * and the creator's user id has to be resolved through the membership row to be
 * compared with it. A creator who has since left the group has no membership, so
 * every remaining row is somebody else's and the list correctly comes out
 * shared.
 *
 * ## `down` drops the column
 *
 * Which is lossy in the only way it can be, since the column is the sole record
 * of the intent, and it returns the product exactly to the behaviour this plan
 * exists to fix rather than to a half state.
 */
/**
 * The backfill of section 2.4, as a constant so the integration test runs the
 * statement the migration runs rather than a retyped copy of it.
 *
 * Re-running it is harmless: it recomputes every row from the access table, so a
 * second run against unchanged data produces the same answer.
 */
export const LIST_SHARED_WITH_ZONE_BACKFILL_SQL = `
  UPDATE "shopping_lists" l SET "sharedWithZone" = EXISTS (
    SELECT 1 FROM "list_access" a
    JOIN "zone_memberships" m ON m.id = a."membershipId"
    WHERE a."listId" = l.id AND m."userId" <> l."createdByUserId"
  )
`;

export class ListSharedWithZone1756000300000 implements MigrationInterface {
  name = 'ListSharedWithZone1756000300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_lists" ADD "sharedWithZone" boolean NOT NULL DEFAULT false`
    );

    await queryRunner.query(LIST_SHARED_WITH_ZONE_BACKFILL_SQL);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_lists" DROP COLUMN "sharedWithZone"`
    );
  }
}
