import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `source_locations`: which shop of theirs is which of ours (plan 0084, section
 * 6).
 *
 * The unique key is (`supermarketId`, `externalId`) and **`externalId` is the
 * source's own code, never the name it prints**. DEZA labels each shop `T1` to
 * `T7`, `C1`, `C2` and `Z1` in the markup and prints a street name beside it.
 * Only the code survives a rename, and a mapping keyed on the display name
 * detaches into `UNMAPPED` the day marketing retitles a shop, which reads as
 * "they closed it".
 *
 * `ItemSourceMatch` gains `NAME_SIZE` here rather than borrowing
 * `NAME_BRAND_SIZE`: a shop has neither a brand nor a size, and a label naming
 * two fields the comparison never read is a label that lies to whoever reads the
 * queue. `IF NOT EXISTS` because plan 0081 adds the same value for its aliases,
 * and whichever of the two lands first must not break the other. Postgres 16
 * allows this inside a transaction as long as the value is not used before the
 * commit, and nothing here inserts a row.
 */
export class SourceLocations1756500000000 implements MigrationInterface {
  name = 'SourceLocations1756500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "item_source_match" ADD VALUE IF NOT EXISTS 'NAME_SIZE'`
    );
    await queryRunner.query(
      `CREATE TYPE "source_location_status" AS ENUM (
        'ACTIVE', 'UNMAPPED', 'IGNORED'
      )`
    );

    await queryRunner.query(`
      CREATE TABLE "source_locations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "supermarketId" uuid NOT NULL,
        "externalId" character varying NOT NULL,
        "printedName" character varying NOT NULL,
        "supermarketLocationId" uuid,
        "status" "source_location_status" NOT NULL DEFAULT 'UNMAPPED',
        "matchedBy" "item_source_match" NOT NULL,
        "firstSeenAt" timestamptz NOT NULL DEFAULT now(),
        "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
        "firstRunId" uuid,
        "lastRunId" uuid,
        CONSTRAINT "pk_source_locations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_source_location"
        ON "source_locations" ("supermarketId", "externalId")
    `);
    // The queue is a status filter defaulting to UNMAPPED, so this is the index
    // the back office reads through on every visit.
    await queryRunner.query(`
      CREATE INDEX "ix_source_locations_status"
        ON "source_locations" ("status")
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "source_locations" IS
        'One shop a source names, and the catalog location it points at once somebody says which (plan 0084). Keyed on the source code so a renamed shop keeps its mapping.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "source_locations"."status" IS
        'ACTIVE is mapped, UNMAPPED is waiting for a person and is skipped by every run, IGNORED is a place the source lists that we do not sell from. A run never writes IGNORED.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "source_locations"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "source_location_status"`);
    // `item_source_match` keeps its new label. Postgres cannot drop one enum
    // value, and the alternative, recreating the type, would rewrite every
    // `item_source_refs` row to undo an addition nothing was harmed by.
  }
}
