import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes for the zone summary (plan 0017, section 4.3). No schema change: every
 * number in the summary is computed on read, so this migration only makes those
 * reads index backed.
 *
 * Three of the existing indexes are strict prefixes of the new ones and are
 * dropped in the same migration rather than left behind to be maintained on
 * every write for no read.
 *
 * Note that the uniqueness in `1756000100000-InitialCoreSchema` is declared as
 * table constraints, not standalone indexes, so anything removing one would need
 * `ALTER TABLE ... DROP CONSTRAINT`. Nothing here does.
 */
export class CountIndexes1756000600000 implements MigrationInterface {
  name = 'CountIndexes1756000600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Serves the member and pending counts as an index only scan.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_zone_status" ON "zone_memberships" ("zoneId", "status")`
    );
    // Serves zone.countsMine and the listMine filter, which until now used
    // ix_membership_user on ("userId") alone and filtered the status in the heap.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_user_status" ON "zone_memberships" ("userId", "status")`
    );
    await queryRunner.query(`DROP INDEX "ix_membership_user"`);
    // The first pending requester, as a one row index read. Partial because
    // pending rows are a small minority and this index should stay tiny.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_zone_pending_created" ON "zone_memberships" ("zoneId", "createdAt", "id") WHERE "status" = 'PENDING'`
    );
    // Serves both line counts.
    await queryRunner.query(
      `CREATE INDEX "ix_lines_list_status" ON "list_lines" ("listId", "status")`
    );
    await queryRunner.query(`DROP INDEX "ix_lines_list"`);
    // Serves the preview ordering.
    await queryRunner.query(
      `CREATE INDEX "ix_lists_zone_updated" ON "shopping_lists" ("zoneId", "updatedAt" DESC, "id")`
    );
    await queryRunner.query(`DROP INDEX "ix_lists_zone"`);
    // `list_access` already has uq_list_access on ("listId", "membershipId"),
    // which serves the readability EXISTS probe. Nothing to add.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "ix_lists_zone" ON "shopping_lists" ("zoneId")`
    );
    await queryRunner.query(`DROP INDEX "ix_lists_zone_updated"`);
    await queryRunner.query(
      `CREATE INDEX "ix_lines_list" ON "list_lines" ("listId")`
    );
    await queryRunner.query(`DROP INDEX "ix_lines_list_status"`);
    await queryRunner.query(`DROP INDEX "ix_memberships_zone_pending_created"`);
    await queryRunner.query(
      `CREATE INDEX "ix_membership_user" ON "zone_memberships" ("userId")`
    );
    await queryRunner.query(`DROP INDEX "ix_memberships_user_status"`);
    await queryRunner.query(`DROP INDEX "ix_memberships_zone_status"`);
  }
}
