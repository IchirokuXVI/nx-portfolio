import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The global username (plan 0018, section 8.1). Expand and contract in one
 * migration: add the column nullable, backfill every existing row, then make it
 * NOT NULL. One migration is safe here because the table is small and the
 * backfill is deterministic.
 *
 * No unique index. Usernames are deliberately not unique (section 2); the plain
 * `ix_users_username` exists only so the back office can search by name.
 *
 * Append only.
 */
export class GlobalUsername1756000700000 implements MigrationInterface {
  name = 'GlobalUsername1756000700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "username" varchar`
    );

    // The TypeScript generator cannot run inside a raw SQL migration and the
    // repo's rule is that migrations are raw SQL, so the backfill uses a small
    // inline English pool: a pre-existing row has no recorded locale and `en` is
    // DEFAULT_LOCALE. Picking from `hashtext(id)` makes it deterministic, so
    // re-running this on a copy of the database produces the same names. The
    // inline pool is a subset of the real one and is allowed to drift from it;
    // it exists only to fill rows that predate the feature.
    await queryRunner.query(`
      UPDATE "users" SET "username" =
        (ARRAY[
          'Swift','Steady','Bright','Bold','Calm','Deep','Silver','Golden',
          'Restless','Distant','Nimble','Quiet'
        ])[1 + (abs(hashtext("id"::text)) % 12)]
        || ' ' ||
        (ARRAY[
          'Sail','Helm','Keel','Mast','Rudder','Anchor','Compass','Beacon',
          'Harbor','Lantern','Tide','Current','Horizon','Reef','Wake','Voyage'
        ])[1 + (abs(hashtext("id"::text || 'n')) % 16)]
      WHERE "username" IS NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_users_username" ON "users" ("username")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_users_username"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}
