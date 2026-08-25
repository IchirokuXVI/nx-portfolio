import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Third core migration (plan 0008, section 6): adds the per zone `merge_requests`
 * table and its status enum. A merge reassigns one zone's data from a source
 * account to a target account on owner approval; the row records who requested it
 * and who resolved it. Append only.
 */
export class MergeRequests1756000300000 implements MigrationInterface {
  name = 'MergeRequests1756000300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "merge_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`
    );

    await queryRunner.query(`
      CREATE TABLE "merge_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "zoneId" uuid NOT NULL,
        "sourceUserId" uuid NOT NULL,
        "targetUserId" uuid NOT NULL,
        "requestedByUserId" uuid NOT NULL,
        "status" "merge_request_status" NOT NULL DEFAULT 'PENDING',
        "resolvedByUserId" uuid,
        CONSTRAINT "pk_merge_requests" PRIMARY KEY ("id"),
        CONSTRAINT "fk_merge_requests_zone" FOREIGN KEY ("zoneId")
          REFERENCES "zones" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_merge_requests_zone" ON "merge_requests" ("zoneId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "merge_requests"`);
    await queryRunner.query(`DROP TYPE "merge_request_status"`);
  }
}
