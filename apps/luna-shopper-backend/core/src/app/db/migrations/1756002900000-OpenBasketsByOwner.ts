import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The open baskets of one owner, found without reading the finished ones (plan
 * 0139, section 2).
 *
 * One partial index and no data movement. Plan 0139 asks, after every write to a
 * list line, which open baskets cover that list. The query walks the zone's
 * memberships and probes `generated_lists` by owner, and the index that served
 * that probe was `ix_generated_lists_owner ("ownerUserId", "generatedAt")`: it
 * finds the owner's baskets and then drags every finished one of them through
 * the `status` filter. A household that has shopped for a year has hundreds of
 * those and one open basket.
 *
 * The predicate is written with the literal `'OPEN'` rather than through the
 * enum type, which is what makes the index usable: Postgres matches a partial
 * index by proving the query's predicate implies the index's, and both sides
 * here are the same comparison against the same literal.
 *
 * ## Why it is not merged into `ix_generated_lists_owner`
 *
 * That index orders by `generatedAt` and serves the owner's basket **listing**,
 * which is every status in date order. The two questions want different rows, so
 * one index answering both would answer neither well.
 */
export class OpenBasketsByOwner1756002900000 implements MigrationInterface {
  name = 'OpenBasketsByOwner1756002900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "ix_generated_lists_owner_open"
        ON "generated_lists" ("ownerUserId")
        WHERE "status" = 'OPEN'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_generated_lists_owner_open"`
    );
  }
}
