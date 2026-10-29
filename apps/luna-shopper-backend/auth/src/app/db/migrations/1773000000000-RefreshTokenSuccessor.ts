import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which refresh row replaced which, and when (plan 0229, section 2): two
 * nullable columns on `refresh_tokens`.
 *
 * `replacedById` names the successor. `replacedAt` is the moment that the
 * rotation which wrote the pointer finished, on the wall clock of the
 * database. One statement writes both, so no row has a pointer without its
 * moment. The moment is its own column and not `updatedAt`, because TypeORM
 * rewrites `updatedAt` on every update: a later write to a revoked row would
 * then move the moment that the `in_flight` rule reads.
 *
 * It only adds. No existing row changes, and every existing revoked row reads
 * as revoked with no successor, which is what it was. Such a row never takes
 * the reuse grace. No release task: nothing that a person or a run wrote is
 * read, changed or deleted.
 *
 * No index. The only read of either column goes from a row that was just
 * locked by its hash to its successor by primary key. `ON DELETE SET NULL`, so
 * a successor that goes away (with its user, by the existing cascade) never
 * blocks the delete.
 */
export class RefreshTokenSuccessor1773000000000 implements MigrationInterface {
  name = 'RefreshTokenSuccessor1773000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "replacedById" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "replacedAt" timestamptz`
    );
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_refresh_tokens_replaced_by"
        FOREIGN KEY ("replacedById")
        REFERENCES "refresh_tokens" ("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "fk_refresh_tokens_replaced_by"`
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "replacedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "replacedById"`
    );
  }
}
