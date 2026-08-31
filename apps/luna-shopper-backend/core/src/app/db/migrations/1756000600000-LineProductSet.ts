import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line holds a set of products (plan 0048, section 1.1).
 *
 * The single nullable `list_lines."itemId"` plan 0007 shipped is replaced by a
 * join table and a digest. **Nothing moves**, in the sense the plan means it: the
 * column is null on every line ever created, because plan 0012 put the catalog
 * out of the client's scope and the composer that would have filled it is only
 * being built now. The copy below exists so this migration is correct rather than
 * merely true today, and so a developer's seeded database survives it.
 *
 * ## Why a set at all
 *
 * Picking a group in the composer copies that group's members onto the line, and
 * the line references no group afterwards. That copy is the point: the catalog
 * does not have to curate a group for every household's version of "milk",
 * because a line is its own hand made group, and removing a product the household
 * never buys is then an ordinary edit of that line.
 *
 * ## What `itemSetHash` is for
 *
 * A digest of the sorted distinct item ids, so **two lines carrying the same
 * products carry the same hash however the products got there**. That is what the
 * dedup rule in `0050` merges on, what velista `0043`'s cross list indicator
 * matches on, and what could later count how many households hold one hand made
 * set. It is null while the set is empty, which is the honest value: no products
 * is not a set worth identifying.
 *
 * The digest is computed here in SQL and in `item-set-hash.ts` in the service,
 * and the two have to agree: sorted distinct ids, joined with commas, SHA-256,
 * lower case hex. The spec beside that file is what pins it.
 *
 * There is no foreign key on `"itemId"` and there could not be: catalog is a
 * separate service with its own database, so the reference is opaque and its
 * shape is checked in application code, exactly as the retired column's was.
 */
export class LineProductSet1756000600000 implements MigrationInterface {
  name = 'LineProductSet1756000600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "list_line_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "lineId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "position" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_list_line_items" PRIMARY KEY ("id"),
        CONSTRAINT "uq_list_line_item" UNIQUE ("lineId", "itemId"),
        CONSTRAINT "fk_list_line_items_line" FOREIGN KEY ("lineId")
          REFERENCES "list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_line_items"."itemId" IS
        'Opaque reference to a catalog Item (plan 0012, plan 0048). Validated in application code, never a database foreign key: catalog is a separate service with its own database.'
    `);
    // The insertion order the composer produced, which is the order the line is
    // drawn in. Explicit rather than derived from `createdAt`, because a set
    // written in one statement shares a timestamp to the microsecond.
    await queryRunner.query(
      `CREATE INDEX "ix_list_line_items_line" ON "list_line_items" ("lineId", "position")`
    );
    await queryRunner.query(
      `CREATE INDEX "ix_list_line_items_item" ON "list_line_items" ("itemId")`
    );

    // Carry across whatever the retired column held. Position zero: there was
    // only ever one, so there is no order to preserve.
    await queryRunner.query(`
      INSERT INTO "list_line_items" ("lineId", "itemId", "position")
      SELECT "id", "itemId", 0 FROM "list_lines" WHERE "itemId" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "list_lines" ADD COLUMN "itemSetHash" varchar`
    );
    await queryRunner.query(`
      UPDATE "list_lines" l
      SET "itemSetHash" = digest."hash"
      FROM (
        SELECT "lineId",
               encode(
                 sha256(
                   convert_to(
                     string_agg(DISTINCT "itemId"::text, ',' ORDER BY "itemId"::text),
                     'UTF8'
                   )
                 ),
                 'hex'
               ) AS "hash"
        FROM "list_line_items"
        GROUP BY "lineId"
      ) digest
      WHERE digest."lineId" = l."id"
    `);
    // What the cross list indicator and the dedup rule look a line up by.
    await queryRunner.query(`
      CREATE INDEX "ix_lines_item_set_hash" ON "list_lines" ("itemSetHash")
        WHERE "itemSetHash" IS NOT NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_lines_item"`);
    await queryRunner.query(`ALTER TABLE "list_lines" DROP COLUMN "itemId"`);
  }

  /**
   * The reverse, and it is lossy in the obvious way: a column that holds one
   * reference cannot hold a set. The **first** product of each line goes back,
   * because that is the one a set of size one contains and therefore the only
   * case where reversing loses nothing at all.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "list_lines" ADD COLUMN "itemId" uuid`);
    await queryRunner.query(`
      UPDATE "list_lines" l
      SET "itemId" = first."itemId"
      FROM (
        SELECT DISTINCT ON ("lineId") "lineId", "itemId"
        FROM "list_line_items"
        ORDER BY "lineId", "position", "id"
      ) first
      WHERE first."lineId" = l."id"
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."itemId" IS
        'Opaque reference to a catalog Item (plan 0012). Validated in application code, never a database foreign key: catalog is a separate service with its own database.'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_lines_item" ON "list_lines" ("itemId") WHERE "itemId" IS NOT NULL`
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_lines_item_set_hash"`);
    await queryRunner.query(
      `ALTER TABLE "list_lines" DROP COLUMN "itemSetHash"`
    );
    await queryRunner.query(`DROP TABLE "list_line_items"`);
  }
}
