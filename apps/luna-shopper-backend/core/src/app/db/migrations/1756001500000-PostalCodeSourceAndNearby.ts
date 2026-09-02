import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a postal code came from, and the two flags the expansion needs (plan
 * 0062, section 7).
 *
 * Four additive columns on `profile_postal_codes` and one new enum type. No data
 * moves and no index changes: `uq_profile_postal_code` stays unique on
 * `("profileId", "postalCode")` without the country, which is what lets section
 * 3.2's promotion be a lookup by code alone rather than by a pair the client
 * would have to have read first.
 *
 * **`source` backfills to `TYPED`**, which is what every existing row is: before
 * this plan the only way a code reached a profile was somebody typing it. The
 * default stays `TYPED` afterwards for the same reason, so a write that says
 * nothing about where a code came from says the honest thing.
 */
export class PostalCodeSourceAndNearby1756001500000 implements MigrationInterface {
  name = 'PostalCodeSourceAndNearby1756001500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "profile_postal_code_source" AS ENUM ('TYPED', 'DEVICE', 'NEARBY')
    `);

    // The default carries the backfill: every existing row is one somebody
    // typed, so adding the column with `DEFAULT 'TYPED'` fills them in one
    // statement rather than in an UPDATE that would have to be written twice.
    await queryRunner.query(`
      ALTER TABLE "profile_postal_codes"
        ADD COLUMN "country" varchar(2) NOT NULL DEFAULT 'es',
        ADD COLUMN "source" "profile_postal_code_source" NOT NULL DEFAULT 'TYPED',
        ADD COLUMN "expandNearby" boolean NOT NULL DEFAULT false,
        ADD COLUMN "suppressed" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "profile_postal_codes"."country" IS
        'ISO 3166-1 alpha-2, lowercase (plan 0062, section 1). The centroid table is keyed on (country, postalCode), and a lookup without one searches every shipped country at once.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_postal_codes"."source" IS
        'Whose code this is (plan 0062, section 1). TYPED and DEVICE are the user''s and behave identically; NEARBY is one we derived and is never accepted as input. Typing a derived code promotes it (section 3.2).'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_postal_codes"."expandNearby" IS
        'Whether this code''s neighbours were asked for (plan 0062, section 1). On the parent rather than a one shot argument, because the derived set is recomputed in full on every change and has to know later which parents wanted expansion.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_postal_codes"."suppressed" IS
        'A derived code the user removed (plan 0062, section 3.1). Removing one is not a delete, because a pure recompute would put it straight back. The row stays and disappears from every read; when its last justifying parent goes away the recompute deletes it like any other derived row.'
    `);

    // Every read of a profile's codes filters the suppressed ones out, and the
    // recompute reads the derived ones by source. One index serves both.
    await queryRunner.query(`
      CREATE INDEX "ix_profile_postal_codes_source"
        ON "profile_postal_codes" ("profileId", "source", "suppressed")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_profile_postal_codes_source"`);
    // The derived rows go with the columns that explain them: without `source`
    // there is no way to tell one from a code the user typed, and leaving them
    // behind would hand the older schema rows nobody can account for.
    await queryRunner.query(`
      DELETE FROM "profile_postal_codes" WHERE "source" = 'NEARBY'
    `);
    await queryRunner.query(`
      ALTER TABLE "profile_postal_codes"
        DROP COLUMN "suppressed",
        DROP COLUMN "expandNearby",
        DROP COLUMN "source",
        DROP COLUMN "country"
    `);
    await queryRunner.query(`DROP TYPE "profile_postal_code_source"`);
  }
}
