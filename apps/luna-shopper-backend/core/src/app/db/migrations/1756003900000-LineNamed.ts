import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line says whether a person named it (plan 0207, section 1.1).
 *
 * One column on `list_lines`, `named boolean NOT NULL DEFAULT true`, and
 * nothing else.
 *
 * **Every existing row becomes true, through the default.** The migration
 * writes no row a person wrote: `content` and every other column of every line
 * are as they were. A line that was made from a product before this plan then
 * says that it was named, although its name is the name of its product. The
 * server cannot tell such a line from a line a person renamed, because the
 * change log does not go back far enough and the catalog is another database.
 * The owner decided on 2026-10-13 that no release task guesses at them, and
 * velista plan 0144 treats them on the screen.
 *
 * No check constraint says that a line with no product is named. The products
 * are rows of `list_line_items`, and a check cannot read another table. The
 * services keep the rule (`line-named.ts`).
 *
 * No index, because nothing reads lines by the flag.
 *
 * It adds no enum and extends none, so the single transaction `migrate.ts` runs
 * everything in is no obstacle.
 *
 * `down` drops the column, which loses the fact for every line made after
 * `up`. It leaves every name as it is.
 */
export class LineNamed1756003900000 implements MigrationInterface {
  name = 'LineNamed1756003900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        ADD COLUMN "named" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."named" IS
        'Whether a person typed the name of the line (plan 0207). False means that content is the name a product had when the line was made. Always true on a line with no product; the services keep that rule.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "list_lines" DROP COLUMN "named"
    `);
  }
}
