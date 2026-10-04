import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a run learned about which shop carries which product, kept on the queue
 * row (plan 0182).
 *
 * A run held its availability claims in memory and wrote them to catalog once,
 * at its end, for the rows that were already bound to a product and the shops
 * that were already mapped. The first run of a chain has neither, so every
 * claim was dropped, and a DEZA run produces nothing else: the site prints no
 * price. This table is where a claim waits for the binding and the shop.
 *
 * **Nothing is backfilled, because there is nothing to read.** The claims of
 * every run before this migration were never stored. The next run of a chain
 * writes them.
 *
 * Both foreign keys cascade. A claim names a row of the source and a shop of
 * the source, and means nothing once either is gone.
 */
export class SourceEntryAvailability1758200000000 implements MigrationInterface {
  name = 'SourceEntryAvailability1758200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "source_entry_availability" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "entryId" uuid NOT NULL,
        "sourceLocationId" uuid NOT NULL,
        "available" boolean NOT NULL,
        "observedAt" timestamptz NOT NULL DEFAULT now(),
        "runId" uuid,
        CONSTRAINT "pk_source_entry_availability" PRIMARY KEY ("id"),
        CONSTRAINT "uq_source_entry_availability"
          UNIQUE ("entryId", "sourceLocationId"),
        CONSTRAINT "fk_source_entry_availability_entry"
          FOREIGN KEY ("entryId")
          REFERENCES "source_catalog_entries" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_source_entry_availability_location"
          FOREIGN KEY ("sourceLocationId")
          REFERENCES "source_locations" ("id") ON DELETE CASCADE
      )
    `);
    // Mapping a shop reads every claim of that shop, and the unique constraint
    // leads with the entry.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_source_entry_availability_location"
        ON "source_entry_availability" ("sourceLocationId")
    `);
    // The end of a run counts and sends what that run stated.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_source_entry_availability_run"
        ON "source_entry_availability" ("runId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "source_entry_availability"`);
  }
}
