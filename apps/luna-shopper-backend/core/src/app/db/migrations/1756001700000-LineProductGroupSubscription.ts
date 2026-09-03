import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line stays subscribed to its product group (plan 0070, section 10).
 *
 * Three DDL changes and **no backfill**. Plan 0048 made picking a group a one
 * time copy, so a line that said eleven milks still said eleven a month after the
 * catalog learned about three more, and nothing in the product could ever tell it
 * otherwise. The line keeps a reference to its group now, plus a record of how it
 * differs from it, which protects a household's divergence just as well as
 * forgetting did without throwing away every correction the catalog will make.
 *
 * ## Why there is nothing to backfill
 *
 * Every existing `list_line_items` row takes the column default, `USER`, and
 * every existing line gets a null `productGroupId`. That is the invariant in
 * section 3 applied to data whose provenance genuinely is not recorded anywhere:
 * a product whose origin is unknown belongs to the person holding it, because the
 * failure mode of guessing wrong in that direction is a line that syncs slightly
 * less than it could, and the failure mode of guessing wrong in the other is the
 * app deleting products out of somebody's shopping list on the strength of a
 * guess.
 *
 * **Existing lines are not retro bound to groups by `itemSetHash`** either. A
 * line whose set happens to match Milk's members today was still assembled by a
 * person, and enrolling it into a subscription it never asked for is an edit
 * nobody asked for, applied to every household at once. Somebody who wants the
 * subscription can pick the group again.
 *
 * ## The removals are a table
 *
 * A person who deletes a group added product has to leave a **record**, not an
 * absence: with the row simply gone, the next sync cannot tell a product somebody
 * refused from a product that has just joined the group, and it would put the
 * refused one back forever. It is not a `removed` flag on `list_line_items`
 * because the membership table is read on every list read, where a forgotten
 * predicate leaks a deleted product onto a screen, and because
 * `uq_list_line_item` means "this product is on this line" and a tombstone is the
 * opposite statement.
 *
 * Neither `"productGroupId"` nor the removals' `"itemId"` carries a foreign key,
 * and neither could: both name rows in catalog's database, which core cannot
 * reference. Same rule as `list_line_items."itemId"`, checked for shape in
 * application code.
 */
export class LineProductGroupSubscription1756001700000 implements MigrationInterface {
  name = 'LineProductGroupSubscription1756001700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "list_lines" ADD COLUMN "productGroupId" uuid`
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."productGroupId" IS
        'Opaque reference to a catalog ProductGroup (plan 0070). The group this line is subscribed to, or null for a hand made set. Validated in application code, never a database foreign key: catalog is a separate service with its own database.'
    `);
    // Partial, because almost every line in the product is null here and the
    // only question ever asked of this column is "which lines are bound to this
    // group" (plan 0070, section 6.4).
    await queryRunner.query(`
      CREATE INDEX "ix_lines_product_group" ON "list_lines" ("productGroupId")
        WHERE "productGroupId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TYPE "list_line_items_source_enum" AS ENUM ('GROUP', 'USER')
    `);
    // `USER` for every row that already exists, which is the whole of the
    // no backfill argument above: unknown provenance belongs to the person.
    await queryRunner.query(`
      ALTER TABLE "list_line_items"
        ADD COLUMN "source" "list_line_items_source_enum" NOT NULL DEFAULT 'USER'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_line_items"."source" IS
        'Who put this product on the line (plan 0070). GROUP may become USER and never back: the app never takes ownership of something a person touched.'
    `);

    await queryRunner.query(`
      CREATE TABLE "list_line_group_removals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "lineId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        CONSTRAINT "pk_list_line_group_removals" PRIMARY KEY ("id"),
        CONSTRAINT "uq_list_line_group_removal" UNIQUE ("lineId", "itemId"),
        CONSTRAINT "fk_list_line_group_removals_line" FOREIGN KEY ("lineId")
          REFERENCES "list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_line_group_removals"."itemId" IS
        'Opaque reference to a catalog Item (plan 0070). A product of this line''s group that a person took off, so a later sync does not put it back.'
    `);
    // The sync reads every removal of one line at once, which is the only read
    // this table has.
    await queryRunner.query(`
      CREATE INDEX "ix_list_line_group_removals_line"
        ON "list_line_group_removals" ("lineId")
    `);
  }

  /**
   * The reverse, and it is lossy in one direction only: the tombstones go, so a
   * line that had refused a product would take it back the next time the group
   * was synced. Nothing on a line disappears, because nothing here put anything
   * on one.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "list_line_group_removals"`);
    await queryRunner.query(
      `ALTER TABLE "list_line_items" DROP COLUMN "source"`
    );
    await queryRunner.query(`DROP TYPE "list_line_items_source_enum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_lines_product_group"`);
    await queryRunner.query(
      `ALTER TABLE "list_lines" DROP COLUMN "productGroupId"`
    );
  }
}
