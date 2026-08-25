import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Second core migration (plan 0007, section 6): adds shopping lists, list access,
 * lines (with their two state machines and a version column) and line comments.
 * `itemId` is a plain nullable column here; its foreign relationship to the
 * catalog arrives in plan 0012. Append only.
 */
export class ListsAndLines1756000200000 implements MigrationInterface {
  name = 'ListsAndLines1756000200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "list_role" AS ENUM ('READER', 'WRITER')`
    );
    await queryRunner.query(
      `CREATE TYPE "line_approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED')`
    );
    await queryRunner.query(
      `CREATE TYPE "line_status" AS ENUM ('PENDING', 'READY', 'NOT_AVAILABLE')`
    );

    await queryRunner.query(`
      CREATE TABLE "shopping_lists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "zoneId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "createdByUserId" uuid NOT NULL,
        CONSTRAINT "pk_shopping_lists" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lists_zone" FOREIGN KEY ("zoneId")
          REFERENCES "zones" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_lists_zone" ON "shopping_lists" ("zoneId")`
    );

    await queryRunner.query(`
      CREATE TABLE "list_access" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "listId" uuid NOT NULL,
        "membershipId" uuid NOT NULL,
        "role" "list_role" NOT NULL DEFAULT 'READER',
        CONSTRAINT "pk_list_access" PRIMARY KEY ("id"),
        CONSTRAINT "uq_list_access" UNIQUE ("listId", "membershipId"),
        CONSTRAINT "fk_access_list" FOREIGN KEY ("listId")
          REFERENCES "shopping_lists" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_access_membership" FOREIGN KEY ("membershipId")
          REFERENCES "zone_memberships" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "list_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "listId" uuid NOT NULL,
        "content" varchar NOT NULL,
        "quantity" int NOT NULL DEFAULT 1,
        "itemId" uuid,
        "position" double precision NOT NULL DEFAULT 0,
        "approvalStatus" "line_approval_status" NOT NULL DEFAULT 'PENDING',
        "status" "line_status" NOT NULL DEFAULT 'PENDING',
        "createdByUserId" uuid NOT NULL,
        "approvedByUserId" uuid,
        "version" int NOT NULL DEFAULT 1,
        CONSTRAINT "pk_list_lines" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lines_list" FOREIGN KEY ("listId")
          REFERENCES "shopping_lists" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_lines_list" ON "list_lines" ("listId")`
    );

    await queryRunner.query(`
      CREATE TABLE "line_comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "lineId" uuid NOT NULL,
        "authorUserId" uuid NOT NULL,
        "body" text NOT NULL,
        CONSTRAINT "pk_line_comments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_comments_line" FOREIGN KEY ("lineId")
          REFERENCES "list_lines" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_comments_line" ON "line_comments" ("lineId")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "line_comments"`);
    await queryRunner.query(`DROP TABLE "list_lines"`);
    await queryRunner.query(`DROP TABLE "list_access"`);
    await queryRunner.query(`DROP TABLE "shopping_lists"`);
    await queryRunner.query(`DROP TYPE "line_status"`);
    await queryRunner.query(`DROP TYPE "line_approval_status"`);
    await queryRunner.query(`DROP TYPE "list_role"`);
  }
}
