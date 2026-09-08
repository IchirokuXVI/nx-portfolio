import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the postal code queue needs to become a screen (plan 0097).
 *
 * Three columns and one enum value, and none of them is backfilled:
 *
 * - `placeName` is written by the run's `GEOCODE` stage, so a row that has never
 *   run has no name and cannot be given one without asking Nominatim, which is
 *   the request this column exists to avoid making twice.
 * - `dismissed` starts false everywhere, which is the working set.
 * - `postal_code_discovery_status` gains `PARKED`, for a code an operator added
 *   and asked for no run yet (section 6.1). Every other value is a claim about a
 *   run, and this row has had none.
 * - `discovered_places.postalCodeSource` mirrors the column
 *   `SupermarketLocation` already carries, and **is deliberately left null on
 *   every existing row** (section 3). A migration in the harvester cannot ask
 *   catalog for a nearest centroid, and a one off script would be a second code
 *   path for a table that refills itself: the upsert updates an existing row's
 *   postal code, so re running a code fills in its own places. The requeue
 *   button is that backfill.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in Postgres
 * before 12, and TypeORM wraps a migration in one. It works from 12 onward as
 * long as the new value is not used in the same transaction, which is why
 * nothing here writes a `PARKED` row.
 */
export class PostalCodeQueueSurface1757000000000 implements MigrationInterface {
  name = 'PostalCodeQueueSurface1757000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "postal_code_discovery_status" ADD VALUE IF NOT EXISTS 'PARKED'`
    );

    await queryRunner.query(`
      ALTER TABLE "postal_code_discovery_requests"
        ADD COLUMN IF NOT EXISTS "placeName" character varying(200),
        ADD COLUMN IF NOT EXISTS "dismissed" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "postal_code_discovery_requests"."placeName" IS
        'What Nominatim calls this code, kept at the GEOCODE stage of a run. Null until one has run: nothing else in the system stores a name for a postal code.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "postal_code_discovery_requests"."dismissed" IS
        'Hidden from the default listing by an operator, usually because the code cannot be geocoded and is a typo. The row stays; a requeue clears this.'
    `);

    // The listing's working set is the undismissed rows, and it filters on the
    // code by prefix, so the index that serves it carries both.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_postal_code_discovery_working_set"
        ON "postal_code_discovery_requests" ("country", "postalCode")
        WHERE "dismissed" = false
    `);

    await queryRunner.query(`
      CREATE TYPE "discovered_place_postal_code_source" AS ENUM (
        'SOURCE', 'DERIVED', 'MANUAL'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "discovered_places"
        ADD COLUMN IF NOT EXISTS "postalCodeSource" "discovered_place_postal_code_source"
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "discovered_places"."postalCodeSource" IS
        'Where postalCode came from: the addr:postcode tag (SOURCE), the nearest centroid within the bound (DERIVED), or neither (null). Null on every row written before plan 0097; a requeue of the code refills them.'
    `);

    // Counting the places located in one code is a listing filter and a panel on
    // the detail screen, both keyed on the pair (plan 0097, sections 2 and 9).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_discovered_places_postal_code"
        ON "discovered_places" ("country", "postalCode")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_discovered_places_postal_code"`
    );
    await queryRunner.query(
      `ALTER TABLE "discovered_places" DROP COLUMN IF EXISTS "postalCodeSource"`
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "discovered_place_postal_code_source"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_postal_code_discovery_working_set"`
    );
    await queryRunner.query(`
      ALTER TABLE "postal_code_discovery_requests"
        DROP COLUMN IF EXISTS "dismissed",
        DROP COLUMN IF EXISTS "placeName"
    `);
    // The enum value stays. Postgres cannot remove one, and recreating the type
    // would mean rewriting the column and every row for a value nothing reads.
  }
}
