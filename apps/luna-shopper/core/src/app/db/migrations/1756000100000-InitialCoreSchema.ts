import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First core migration (plan 0006, section 10): creates `zones` and
 * `zone_memberships` with the zone/membership enums. Append only thereafter;
 * applied by the deploy Job, never by `synchronize`.
 */
export class InitialCoreSchema1756000100000 implements MigrationInterface {
  name = 'InitialCoreSchema1756000100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(
      `CREATE TYPE "zone_status" AS ENUM ('ACTIVE', 'MARKED_FOR_DELETION')`
    );
    await queryRunner.query(
      `CREATE TYPE "zone_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER')`
    );
    await queryRunner.query(
      `CREATE TYPE "membership_status" AS ENUM ('PENDING', 'APPROVED', 'KICKED', 'BANNED')`
    );

    await queryRunner.query(`
      CREATE TABLE "zones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "name" varchar NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "joinCode" varchar NOT NULL,
        "status" "zone_status" NOT NULL DEFAULT 'ACTIVE',
        "ownerUserId" uuid,
        CONSTRAINT "pk_zones" PRIMARY KEY ("id"),
        CONSTRAINT "uq_zones_join_code" UNIQUE ("joinCode")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "zone_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "zoneId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "username" varchar NOT NULL,
        "role" "zone_role" NOT NULL DEFAULT 'MEMBER',
        "status" "membership_status" NOT NULL DEFAULT 'PENDING',
        "approvedByUserId" uuid,
        CONSTRAINT "pk_zone_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "uq_membership_zone_user" UNIQUE ("zoneId", "userId"),
        CONSTRAINT "uq_membership_zone_username" UNIQUE ("zoneId", "username"),
        CONSTRAINT "fk_membership_zone" FOREIGN KEY ("zoneId")
          REFERENCES "zones" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_membership_user" ON "zone_memberships" ("userId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "zone_memberships"`);
    await queryRunner.query(`DROP TABLE "zones"`);
    await queryRunner.query(`DROP TYPE "membership_status"`);
    await queryRunner.query(`DROP TYPE "zone_role"`);
    await queryRunner.query(`DROP TYPE "zone_status"`);
  }
}
