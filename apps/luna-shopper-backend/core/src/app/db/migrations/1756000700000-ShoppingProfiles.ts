import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shopping profiles and their three child tables (plan 0049, section 7).
 *
 * One append only migration, and the only schema change core needs for the plan:
 * the catalog half is a read time resolution rather than a table.
 *
 * ## The two indexes that carry rules
 *
 * `uq_shopping_profiles_default` is a **partial** unique index over `userId`
 * where `isDefault`. That is what makes section 1.3's lazy creation idempotent
 * rather than merely usually correct: two concurrent first reads both insert a
 * default, one of them loses on the constraint, and the loser re reads instead of
 * creating a second profile. A service level check could not do that without a
 * lock, and the invariant it protects (exactly one default per user) is worth a
 * database guarantee.
 *
 * `profile_generation_sources` gets **two** partial unique indexes rather than
 * one plain one over three columns, because `listId` is nullable and Postgres
 * treats nulls as distinct in a unique index: `(profile, zone, null)` would
 * otherwise be insertable twice, and "the whole zone" is exactly the row that
 * must not be duplicated.
 *
 * ## What is deliberately not here
 *
 * No foreign key to catalog on `supermarketId`, which is opaque across a service
 * boundary and validated in application code, exactly as `list_line_items` does
 * it. And no foreign key on `zoneId` or `listId` either: a zone deleted
 * underneath a profile must not be blocked by a preference somebody set in
 * March, so a stale source is dropped when it is read rather than prevented.
 */
export class ShoppingProfiles1756000700000 implements MigrationInterface {
  name = 'ShoppingProfiles1756000700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "generation_scope" AS ENUM ('ALL', 'SELECTED')
    `);

    await queryRunner.query(`
      CREATE TABLE "shopping_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "name" varchar(64),
        "isDefault" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL DEFAULT 0,
        "addressText" varchar(200),
        "minSavingCents" integer NOT NULL DEFAULT 0,
        "minSavingPercent" integer,
        "generationScope" "generation_scope" NOT NULL DEFAULT 'ALL',
        CONSTRAINT "pk_shopping_profiles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "shopping_profiles"."name" IS
        'Null means the client renders its localized default (plan 0049, section 1.3). Core does not know the caller''s locale, so a stored English word in a Spanish account would be wrong forever.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "shopping_profiles"."addressText" IS
        'Display and context only (plan 0049, section 1). Nothing is geocoded; the profile''s postal codes are what resolve to price scopes.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_shopping_profiles_user" ON "shopping_profiles" ("userId", "position")`
    );
    // Exactly one default per user, in the database rather than in the service.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_shopping_profiles_default"
        ON "shopping_profiles" ("userId")
        WHERE "isDefault"
    `);

    await queryRunner.query(`
      CREATE TABLE "profile_postal_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "profileId" uuid NOT NULL,
        "postalCode" varchar(16) NOT NULL,
        "label" varchar(64),
        "position" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_profile_postal_codes" PRIMARY KEY ("id"),
        CONSTRAINT "uq_profile_postal_code" UNIQUE ("profileId", "postalCode"),
        CONSTRAINT "fk_profile_postal_codes_profile" FOREIGN KEY ("profileId")
          REFERENCES "shopping_profiles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_postal_codes"."postalCode" IS
        'Stored exactly as typed and never as what it resolves to (plan 0049, section 1.1): the mapping from a postal code to a price scope belongs to the chain and moves without telling us, so a stored scope id becomes a lie. Resolved per query, in catalog.'
    `);

    await queryRunner.query(`
      CREATE TABLE "profile_supermarket_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "profileId" uuid NOT NULL,
        "supermarketId" uuid NOT NULL,
        "excluded" boolean NOT NULL DEFAULT false,
        CONSTRAINT "pk_profile_supermarket_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "uq_profile_supermarket" UNIQUE ("profileId", "supermarketId"),
        CONSTRAINT "fk_profile_supermarket_preferences_profile" FOREIGN KEY ("profileId")
          REFERENCES "shopping_profiles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_supermarket_preferences"."supermarketId" IS
        'Opaque reference to a catalog Supermarket, the chain and never a location (plan 0049, section 1.2). Validated in application code, never a database foreign key: catalog is a separate service with its own database.'
    `);

    await queryRunner.query(`
      CREATE TABLE "profile_generation_sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "profileId" uuid NOT NULL,
        "zoneId" uuid NOT NULL,
        "listId" uuid,
        CONSTRAINT "pk_profile_generation_sources" PRIMARY KEY ("id"),
        CONSTRAINT "fk_profile_generation_sources_profile" FOREIGN KEY ("profileId")
          REFERENCES "shopping_profiles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "profile_generation_sources"."listId" IS
        'Null means the whole zone rather than one list within it (plan 0049, section 1).'
    `);
    // Two partial indexes, because a nullable column in a unique index does not
    // constrain its null rows: without the second one "the whole zone" could be
    // selected twice.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_profile_generation_source_list"
        ON "profile_generation_sources" ("profileId", "zoneId", "listId")
        WHERE "listId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_profile_generation_source_zone"
        ON "profile_generation_sources" ("profileId", "zoneId")
        WHERE "listId" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // The children first, then the parent, then the type nothing references any
    // more. The cascades would take the children with the parent; dropping them
    // explicitly keeps the reverse readable as the mirror of the forward.
    await queryRunner.query(`DROP TABLE "profile_generation_sources"`);
    await queryRunner.query(`DROP TABLE "profile_supermarket_preferences"`);
    await queryRunner.query(`DROP TABLE "profile_postal_codes"`);
    await queryRunner.query(`DROP TABLE "shopping_profiles"`);
    await queryRunner.query(`DROP TYPE "generation_scope"`);
  }
}
