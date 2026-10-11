import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A chain photo is a link we can turn off (plan 0198).
 *
 * One table and two columns, all additive:
 *
 * - `item_linked_images` holds one link for each source row that is bound to
 *   a product and states a photo. The key is the harvester's row, so a
 *   product built from three rows holds three links.
 * - `items.linkedImages` is the list a shopper may be given, materialized
 *   from the table and the switches. It starts empty.
 * - `supermarkets.linkedImagesEnabled` is the switch of one chain. It starts
 *   false, so the state with no configuration is "no chain photo".
 *
 * **Nothing is shown by this migration.** It writes no link and turns no
 * chain on. The harvester writes the links, and a person turns a chain on.
 *
 * `items.imageUrl` is not touched: it stays the photo the owner chose.
 *
 * The check keeps anything but an `https` address out of the table, whatever
 * writes to it. A client loads these addresses, and a page of ours must not
 * be made to load one in clear text.
 *
 * `down` drops all three. The owner's photos are as they were.
 */
export class ItemLinkedImages1758900000000 implements MigrationInterface {
  name = 'ItemLinkedImages1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "item_linked_images" (
        "sourceEntryId" uuid NOT NULL,
        "itemId"        uuid NOT NULL,
        "supermarketId" uuid NOT NULL,
        "url"           varchar(500) NOT NULL,
        "firstLinkedAt" timestamptz NOT NULL DEFAULT now(),
        "lastSeenAt"    timestamptz NOT NULL DEFAULT now(),
        "runId"         uuid,
        CONSTRAINT "pk_item_linked_images" PRIMARY KEY ("sourceEntryId"),
        CONSTRAINT "fk_item_linked_images_item" FOREIGN KEY ("itemId")
          REFERENCES "items" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_item_linked_images_supermarket"
          FOREIGN KEY ("supermarketId")
          REFERENCES "supermarkets" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_item_linked_images_https" CHECK ("url" LIKE 'https://%')
      )
    `);
    // A product's own links, for the refresh, and the cascade when it goes.
    await queryRunner.query(
      `CREATE INDEX "ix_item_linked_images_item" ON "item_linked_images" ("itemId")`
    );
    // The products that hold a link of one chain, which is what a switch reads.
    await queryRunner.query(
      `CREATE INDEX "ix_item_linked_images_supermarket" ON "item_linked_images" ("supermarketId")`
    );

    await queryRunner.query(
      `ALTER TABLE "items" ADD "linkedImages" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "supermarkets" ADD "linkedImagesEnabled" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "supermarkets" DROP COLUMN "linkedImagesEnabled"`
    );
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "linkedImages"`);
    await queryRunner.query(`DROP INDEX "ix_item_linked_images_supermarket"`);
    await queryRunner.query(`DROP INDEX "ix_item_linked_images_item"`);
    await queryRunner.query(`DROP TABLE "item_linked_images"`);
  }
}
