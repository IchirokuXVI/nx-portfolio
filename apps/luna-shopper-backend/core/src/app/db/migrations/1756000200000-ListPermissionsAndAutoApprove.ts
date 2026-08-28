import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A list permission becomes a set, and a list learns to skip approval (plans
 * 0036 section 3 and 0037 section 3).
 *
 * Two plans in one migration on purpose. They land together, and doing so takes
 * one lock on `shopping_lists` and one on `list_access` rather than two of each
 * (plan 0037, section 6).
 *
 * Appended beside the squashed baseline (`1756000100000-InitialCoreSchema`, plan
 * 0025) rather than folded into it: the baseline is deployed, and the squash was
 * a one time reset taken during the last window in which it was free.
 *
 * ## What happens to the rows that already exist
 *
 * `list_access.role` was a `list_role` with two members. Each maps to the
 * permissions its name actually names, and nothing else:
 *
 * - `READER` becomes `{READ}`;
 * - `WRITER` becomes `{READ,WRITE}`, with **no** `DECIDE`.
 *
 * Handing `WRITER` a `DECIDE` would be inventing a grant nobody made (plan 0036,
 * section 3.1). Approving a line has never been a permission a `list_access` row
 * could carry, so inferring it from a role called `WRITER` would mean this deploy
 * quietly gave every writer in every group a power their group had reserved to
 * its admins. A migration may not do that. The known cost is that today's writers
 * cannot tick a line off until somebody grants them `DECIDE` from the share
 * sheet, which ships in the same release; group admins hold all four on every
 * list by derivation, so no group is left with nobody who can finish a shop.
 *
 * Every list's creator is then inserted or widened to all four. Their power used
 * to be derived from `shopping_lists."createdByUserId"` inside `isManager`, which
 * made it exactly as irrevocable as staff status; it becomes an ordinary row so a
 * group admin can rewrite it, down to and including deleting it (plan 0036,
 * section 2.5). A creator whose membership is gone has no row to write, which the
 * join takes care of by matching nothing.
 *
 * Finally every row left holding an empty set is deleted, because an empty set is
 * not a stored value in this model: no row is the single representation of no
 * access (plan 0036, section 2.2). Only rows a `NOT NULL DEFAULT '{}'` created
 * during this migration can be empty at this point, but the delete is written
 * anyway so the invariant is established by the migration rather than assumed
 * from it.
 *
 * ## No GIN index
 *
 * Plan 0036 section 3.2: every predicate gains an array containment test on a row
 * it was already fetching, located by `uq_list_access (listId, membershipId)` and
 * evaluated on one row. Nothing is added speculatively; if the zone summary ever
 * shows one is needed, GIN on `permissions` is the answer and it is one more
 * migration.
 *
 * ## `down` is lossy, and says so
 *
 * There is no `list_role` value for three of the four permissions, so the reverse
 * flattens: a set holding `MANAGE` or `WRITE` becomes `WRITER`, anything else
 * becomes `READER`. A rollback that quietly promoted every reader would be worse
 * than one that is known to flatten, so the loss is stated here rather than
 * hidden. `autoApproveLines` is dropped outright, since the column is the only
 * record of it.
 */
export class ListPermissionsAndAutoApprove1756000200000 implements MigrationInterface {
  name = 'ListPermissionsAndAutoApprove1756000200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The type. Values match `ListPermission` in the contracts, which is the
    // wire format, so the two cannot be renamed independently.
    await queryRunner.query(
      `CREATE TYPE "list_permission" AS ENUM ('READ', 'WRITE', 'DECIDE', 'MANAGE')`
    );

    // 2. The column, temporarily defaulted so the existing rows have a value to
    // be backfilled over. The default is dropped in step 6: every writer of this
    // table knows the set it means to store, and a default would turn "somebody
    // forgot to say what this row grants" into a silent state.
    await queryRunner.query(
      `ALTER TABLE "list_access" ADD "permissions" "list_permission"[] NOT NULL DEFAULT '{}'`
    );

    // 3. The backfill, one statement per old role so each mapping reads as the
    // sentence that justifies it.
    await queryRunner.query(
      `UPDATE "list_access" SET "permissions" = ARRAY['READ']::"list_permission"[] WHERE "role" = 'READER'`
    );
    await queryRunner.query(
      `UPDATE "list_access" SET "permissions" = ARRAY['READ', 'WRITE']::"list_permission"[] WHERE "role" = 'WRITER'`
    );

    // 4. Every list's creator holds all four, as a row. The creator is a user id
    // on the list, so it reaches `list_access` through the membership that user
    // holds in the list's own zone; a creator who has since left the group has no
    // membership row and the join matches nothing, which is the right answer.
    //
    // Widen first, then insert what is missing. Doing it in that order means the
    // insert's `NOT EXISTS` sees the rows the update has already handled, so
    // neither statement can produce a duplicate that `uq_list_access` would
    // reject halfway through the migration.
    await queryRunner.query(`
      UPDATE "list_access" la
      SET "permissions" = ARRAY['READ', 'WRITE', 'DECIDE', 'MANAGE']::"list_permission"[]
      FROM "shopping_lists" sl
      JOIN "zone_memberships" m
        ON m."zoneId" = sl."zoneId" AND m."userId" = sl."createdByUserId"
      WHERE la."listId" = sl.id AND la."membershipId" = m.id
    `);
    await queryRunner.query(`
      INSERT INTO "list_access" ("listId", "membershipId", "permissions")
      SELECT sl.id, m.id, ARRAY['READ', 'WRITE', 'DECIDE', 'MANAGE']::"list_permission"[]
      FROM "shopping_lists" sl
      JOIN "zone_memberships" m
        ON m."zoneId" = sl."zoneId" AND m."userId" = sl."createdByUserId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "list_access" la
        WHERE la."listId" = sl.id AND la."membershipId" = m.id
      )
    `);

    // 5. An empty set is a deleted row, never a stored value.
    await queryRunner.query(
      `DELETE FROM "list_access" WHERE cardinality("permissions") = 0`
    );

    // 6. The old column and its type go, and the scaffolding default with them.
    await queryRunner.query(
      `ALTER TABLE "list_access" ALTER COLUMN "permissions" DROP DEFAULT`
    );
    await queryRunner.query(`ALTER TABLE "list_access" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "list_role"`);

    // Plan 0037, section 3. Defaulted false, which is what every list created
    // before this shipped behaved as.
    await queryRunner.query(
      `ALTER TABLE "shopping_lists" ADD "autoApproveLines" boolean NOT NULL DEFAULT false`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_lists" DROP COLUMN "autoApproveLines"`
    );

    await queryRunner.query(
      `CREATE TYPE "list_role" AS ENUM ('READER', 'WRITER')`
    );
    await queryRunner.query(
      `ALTER TABLE "list_access" ADD "role" "list_role" NOT NULL DEFAULT 'READER'`
    );
    // The lossy half, stated in the class comment: four permissions collapse into
    // two roles, so `DECIDE` and `MANAGE` have nowhere to go. A set that can write
    // in any sense comes back as `WRITER`; everything else comes back as `READER`,
    // which grants too little rather than too much.
    await queryRunner.query(`
      UPDATE "list_access"
      SET "role" = 'WRITER'
      WHERE 'WRITE' = ANY("permissions") OR 'MANAGE' = ANY("permissions")
    `);

    await queryRunner.query(
      `ALTER TABLE "list_access" DROP COLUMN "permissions"`
    );
    await queryRunner.query(`DROP TYPE "list_permission"`);
  }
}
