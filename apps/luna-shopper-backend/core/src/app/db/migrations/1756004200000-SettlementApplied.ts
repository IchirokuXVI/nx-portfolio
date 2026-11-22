import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A buy records how much of the ask it met (plan 0274, section 1).
 *
 * One column on `line_settlements`, `applied`: how many of the row's units
 * lowered its line. An open basket's ask is the line's quantity plus the
 * `applied` of the basket's standing buys, so a buy above the ask no longer
 * raises the ask by the units above it.
 *
 * **Every existing row gets `applied = quantity`.** That is what the floor of
 * the settle made of it as far as the database can tell: a buy above the ask
 * left no trace of how much of it was above, and the reads before this plan
 * counted every unit as asked. So no number a reader sees changes. A
 * `NOT_AVAILABLE` row has `quantity` 0, so it gets 0.
 *
 * The column is added with a default so the existing rows can take it, and the
 * default is dropped in the same migration. **From then on an insert that does
 * not name `applied` is refused by the `NOT NULL`**, which is the point: every
 * writer has to say how much of its buy met the ask.
 *
 * The check keeps it between 0 and `quantity`. It is added after the fill, so it
 * is validated against rows that already satisfy it.
 *
 * `down` drops the check and the column. The split between the units that met
 * the ask and the ones above it is lost, and the reads go back to counting every
 * unit as asked.
 */
export class SettlementApplied1756004200000 implements MigrationInterface {
  name = 'SettlementApplied1756004200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD COLUMN "applied" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "line_settlements" SET "applied" = "quantity"
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements" ALTER COLUMN "applied" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD CONSTRAINT "ck_line_settlements_applied"
        CHECK ("applied" >= 0 AND "applied" <= "quantity")
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."applied" IS
        'How many of "quantity" lowered the line, so met what the list asked (plan 0274). The rest is above the ask. 0 for NOT_AVAILABLE. No default: every insert names it.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP CONSTRAINT "ck_line_settlements_applied"
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements" DROP COLUMN "applied"
    `);
  }
}
