import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per zone usernames stop being unique (plan 0018, section 2). Two members of one
 * zone may now share a name, and a plain index replaces the constraint so lookups
 * by name still have one.
 *
 * `uq_membership_zone_username` was declared in `InitialCoreSchema` as a table
 * level UNIQUE **constraint**, not a standalone index, so it is dropped with
 * ALTER TABLE; a `DROP INDEX` on that name fails.
 *
 * Append only.
 */
export class DropZoneUsernameUniqueness1756000710000 implements MigrationInterface {
  name = 'DropZoneUsernameUniqueness1756000710000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "zone_memberships" DROP CONSTRAINT "uq_membership_zone_username"`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_membership_zone_username" ON "zone_memberships" ("zoneId", "username")`
    );
  }

  /**
   * Reverting restores the uniqueness rule and **will fail if duplicates exist by
   * then**. That is correct and deliberately not papered over: going back to a
   * rule the data already violates is a real conflict, and a silent dedupe would
   * rename people without asking. Resolve the duplicates first, then revert.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_membership_zone_username"`);
    await queryRunner.query(
      `ALTER TABLE "zone_memberships" ADD CONSTRAINT "uq_membership_zone_username" UNIQUE ("zoneId", "username")`
    );
  }
}
