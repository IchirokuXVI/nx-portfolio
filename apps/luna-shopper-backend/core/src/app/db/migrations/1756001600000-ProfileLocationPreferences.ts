import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The finer half of where a profile shops (plan 0064, section 6).
 *
 * One new table beside `profile_supermarket_preferences`, shaped exactly like
 * it, and **nothing to backfill**: an empty blacklist is the correct starting
 * state for every profile that already exists, so nobody's behaviour changes on
 * deploy. That is the whole reason the finer axis is a blacklist rather than an
 * allowlist, stated once in the entity and once here as a property of the
 * migration.
 *
 * The unique index is what makes a toggle idempotent: a client that sends the
 * same shop twice, or retries a request it never saw the answer to, writes one
 * row either way.
 */
export class ProfileLocationPreferences1756001600000 implements MigrationInterface {
  name = 'ProfileLocationPreferences1756001600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "profile_location_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "profileId" uuid NOT NULL,
        "supermarketLocationId" uuid NOT NULL,
        "excluded" boolean NOT NULL DEFAULT false,
        CONSTRAINT "pk_profile_location_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "uq_profile_location" UNIQUE ("profileId", "supermarketLocationId"),
        CONSTRAINT "fk_profile_location_preferences_profile" FOREIGN KEY ("profileId")
          REFERENCES "shopping_profiles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_location_preferences"."supermarketLocationId" IS
        'Opaque reference to a catalog SupermarketLocation, one shop rather than a chain (plan 0064, section 1). Validated in application code, never a database foreign key: catalog is a separate service with its own database.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_location_preferences"."excluded" IS
        'A blacklist: absence means included, so a shop imported after the user made their choices is one they can see rather than one silently missing (plan 0064, section 1). A row under an excluded chain is inert rather than deleted (section 2.1).'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "profile_location_preferences"`);
  }
}
