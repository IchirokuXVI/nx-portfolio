import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A line counts in a unit (plan 0246, section 7).
 *
 * One enum type, `line_unit` (`UNIT`, `GRAM`, `MILLILITER`), and six columns:
 * the unit of a line, of a settlement and of a trip row, the estimate flag of a
 * settlement, and the unit before and after on a change row.
 *
 * **Every existing row becomes `UNIT`, through the default** (plan 0246 M2).
 * The migration writes no row a person wrote. The few lines that hold a
 * product sold by the kilo keep `UNIT` at quantity 0 until their next edit
 * states `GRAM`, and the unpriced settlements of such products stay pieces. No
 * money is wrong either way.
 *
 * The new type is used by columns in the same transaction, which Postgres
 * allows: only an enum **value** added by `ALTER TYPE ... ADD VALUE` cannot be
 * used before its transaction commits. No index reads the type.
 *
 * `down` drops the six columns and then the type, which loses every unit and
 * every estimate flag. It puts back the comment plan 0143 wrote on
 * `pricePaidCents`.
 */
export class LineUnit1756004100000 implements MigrationInterface {
  name = 'LineUnit1756004100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "line_unit" AS ENUM ('UNIT', 'GRAM', 'MILLILITER')
    `);
    await queryRunner.query(`
      ALTER TABLE "list_lines"
        ADD COLUMN "unit" "line_unit" NOT NULL DEFAULT 'UNIT'
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        ADD COLUMN "unit" "line_unit" NOT NULL DEFAULT 'UNIT',
        ADD COLUMN "estimated" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "basket_trip_rows"
        ADD COLUMN "unit" "line_unit" NOT NULL DEFAULT 'UNIT'
    `);
    await queryRunner.query(`
      ALTER TABLE "list_line_changes"
        ADD COLUMN "unitBefore" "line_unit" NULL,
        ADD COLUMN "unitAfter" "line_unit" NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "list_lines"."unit" IS
        'What quantity counts (plan 0246). Base units: grams and millilitres, never kilos or litres.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."pricePaidCents" IS
        'The price of one of "unit": one piece or pack, or one kilo or litre (plan 0246 M7). Never the row total.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      COMMENT ON COLUMN "line_settlements"."pricePaidCents" IS
        'Catalog price of ONE unit of "itemId" at "priceScopeId", in the minor unit of "pricePaidCurrency", read by the gateway when the settle was made (plan 0143). Not the row total and not catalog unitPrice. Null when nobody knew.'
    `);
    await queryRunner.query(`
      ALTER TABLE "list_line_changes"
        DROP COLUMN "unitAfter",
        DROP COLUMN "unitBefore"
    `);
    await queryRunner.query(`
      ALTER TABLE "basket_trip_rows" DROP COLUMN "unit"
    `);
    await queryRunner.query(`
      ALTER TABLE "line_settlements"
        DROP COLUMN "estimated",
        DROP COLUMN "unit"
    `);
    await queryRunner.query(`
      ALTER TABLE "list_lines" DROP COLUMN "unit"
    `);
    await queryRunner.query(`DROP TYPE "line_unit"`);
  }
}
