import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A shop has walks, and one of them is its map (backend plan 0168, section 1).
 *
 * Two tables, both new, and no data to move:
 *
 * - `shop_walks`: one walk of a shop, its name, whether shoppers see it, and
 *   the document its log folds to. `uq_shop_walks_shown` is the rule "at most
 *   one shown walk per shop": a partial unique index over the shop, on the rows
 *   that are shown and not deleted.
 * - `shop_walk_entries`: the append only log. The primary key is the client's
 *   id, which is what makes a retried save the same entry, and `(walkId, seq)`
 *   is unique. `snapshot` is the fold after an entry, stored on every twentieth
 *   entry and on every rewind; `ix_shop_walk_entries_snapshot` finds the latest
 *   one at or before a `seq` without reading the log.
 *
 * Deleting a shop cascades to its walks and their entries. Deleting a walk is
 * never a row delete (it sets `deletedAt`), so the cascade from a walk to its
 * entries is only reached through its shop.
 *
 * ## Down
 *
 * Drops both tables and the enum type. Nothing else reads them.
 */
export class ShopWalks1758400000000 implements MigrationInterface {
  name = 'ShopWalks1758400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "shop_walk_entry_kind" AS ENUM (
        'started', 'resumed', 'continued', 'stopped', 'edited', 'rewound',
        'confirmed', 'discarded'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "shop_walks" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"             timestamptz NOT NULL DEFAULT now(),
        "updatedAt"             timestamptz NOT NULL DEFAULT now(),
        "supermarketLocationId" uuid NOT NULL,
        "name"                  varchar(80) NOT NULL,
        "shown"                 boolean NOT NULL DEFAULT false,
        "lastSeq"               integer NOT NULL DEFAULT 0,
        "document"              jsonb NOT NULL,
        "createdByUserId"       uuid NOT NULL,
        "deletedAt"             timestamptz NULL,
        CONSTRAINT "pk_shop_walks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_shop_walks_location" FOREIGN KEY ("supermarketLocationId")
          REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_shop_walks_last_seq" CHECK ("lastSeq" >= 0),
        CONSTRAINT "ck_shop_walks_deleted_not_shown" CHECK (NOT ("shown" AND "deletedAt" IS NOT NULL))
      )
    `);
    // One shown walk per shop.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shop_walks_shown"
         ON "shop_walks" ("supermarketLocationId")
         WHERE "shown" AND "deletedAt" IS NULL`
    );
    // A shop's walks, the list read and the cascade from a shop.
    await queryRunner.query(
      `CREATE INDEX "ix_shop_walks_location"
         ON "shop_walks" ("supermarketLocationId")`
    );

    await queryRunner.query(`
      CREATE TABLE "shop_walk_entries" (
        "id"              uuid NOT NULL,
        "walkId"          uuid NOT NULL,
        "seq"             integer NOT NULL,
        "kind"            "shop_walk_entry_kind" NOT NULL,
        "at"              timestamptz NOT NULL,
        "logFrom"         bigint NOT NULL,
        "logTo"           bigint NOT NULL,
        "events"          jsonb NOT NULL,
        "rewoundTo"       bigint NULL,
        "reason"          varchar(40) NULL,
        "snapshot"        jsonb NULL,
        "createdByUserId" uuid NOT NULL,
        "createdAt"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_shop_walk_entries" PRIMARY KEY ("id"),
        CONSTRAINT "uq_shop_walk_entries_seq" UNIQUE ("walkId", "seq"),
        CONSTRAINT "fk_shop_walk_entries_walk" FOREIGN KEY ("walkId")
          REFERENCES "shop_walks" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_shop_walk_entries_seq" CHECK ("seq" >= 1),
        CONSTRAINT "ck_shop_walk_entries_log" CHECK ("logFrom" >= 0 AND "logTo" >= 0)
      )
    `);
    // The latest snapshot at or before a seq.
    await queryRunner.query(
      `CREATE INDEX "ix_shop_walk_entries_snapshot"
         ON "shop_walk_entries" ("walkId", "seq")
         WHERE "snapshot" IS NOT NULL`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shop_walk_entries"`);
    await queryRunner.query(`DROP TABLE "shop_walks"`);
    await queryRunner.query(`DROP TYPE "shop_walk_entry_kind"`);
  }
}
