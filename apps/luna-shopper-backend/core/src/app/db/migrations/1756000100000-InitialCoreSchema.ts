import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The core baseline (plan 0025). Creates zones and memberships, shopping lists
 * with their access rows, lines and comments, merge requests, and the
 * `processed_events` inbox.
 *
 * This is a squash. It replaces the original `InitialCoreSchema` plus
 * `ListsAndLines` (plan 0007), `MergeRequests` (plan 0008),
 * `FormalizeLineItemRef` (plan 0012), `AccountDeletion` (plan 0011),
 * `CountIndexes` (plan 0017) and `DropZoneUsernameUniqueness` (plan 0018), which
 * were collapsed while the service had never been deployed and no database
 * anywhere held their history. Those plans still describe the decisions; only the
 * migration files were merged.
 *
 * Three things the merged history used to do and this file does not, because the
 * intermediate state never reached a real database:
 *
 * - `uq_membership_zone_username` is **never created**. It existed in the first
 *   migration and was dropped in plan 0018's; per zone usernames are not unique.
 * - `ix_membership_user`, `ix_lines_list` and `ix_lists_zone` are **never
 *   created**. Each was a strict prefix of an index plan 0017 added, and each was
 *   dropped by the same migration that added its replacement.
 * - `users.username`, `zones.markedForDeletionAt` and the `list_lines.itemId`
 *   index and comment are created in place rather than added by later ALTERs.
 *
 * **Append only from here.** The squash was a one time reset of the baseline,
 * taken during the last window in which it was free. Every later change is a new
 * migration, never an edit to this one.
 *
 * Applied by the deploy Job (plan 0002); `synchronize` is never used.
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
    await queryRunner.query(
      `CREATE TYPE "list_role" AS ENUM ('READER', 'WRITER')`
    );
    await queryRunner.query(
      `CREATE TYPE "line_approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED')`
    );
    await queryRunner.query(
      `CREATE TYPE "line_status" AS ENUM ('PENDING', 'READY', 'NOT_AVAILABLE')`
    );
    await queryRunner.query(
      `CREATE TYPE "merge_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`
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
        "markedForDeletionAt" timestamptz,
        CONSTRAINT "pk_zones" PRIMARY KEY ("id"),
        CONSTRAINT "uq_zones_join_code" UNIQUE ("joinCode")
      )
    `);
    // Partial: the zone reaper scans only marked zones (plan 0011).
    await queryRunner.query(
      `CREATE INDEX "ix_zones_marked_for_deletion" ON "zones" ("markedForDeletionAt") WHERE "markedForDeletionAt" IS NOT NULL`
    );

    // No uniqueness on ("zoneId", "username"): two members of one zone may share
    // a name (plan 0018, section 2). The plain index below is what lookups by
    // name use instead.
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
        CONSTRAINT "fk_membership_zone" FOREIGN KEY ("zoneId")
          REFERENCES "zones" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_membership_zone_username" ON "zone_memberships" ("zoneId", "username")`
    );
    // Serves the member and pending counts as an index only scan (plan 0017).
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_zone_status" ON "zone_memberships" ("zoneId", "status")`
    );
    // Serves zone.countsMine and the listMine filter.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_user_status" ON "zone_memberships" ("userId", "status")`
    );
    // The first pending requester, as a one row index read. Partial because
    // pending rows are a small minority and this index should stay tiny.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_zone_pending_created" ON "zone_memberships" ("zoneId", "createdAt", "id") WHERE "status" = 'PENDING'`
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
    // Serves the preview ordering (plan 0017).
    await queryRunner.query(
      `CREATE INDEX "ix_lists_zone_updated" ON "shopping_lists" ("zoneId", "updatedAt" DESC, "id")`
    );

    // uq_list_access on ("listId", "membershipId") also serves the readability
    // EXISTS probe, so there is no separate index here.
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
    // Serves both line counts (plan 0017).
    await queryRunner.query(
      `CREATE INDEX "ix_lines_list_status" ON "list_lines" ("listId", "status")`
    );
    // The catalog link (plan 0012, section 4): an index for the lookups that
    // filter lines by item, and NO foreign key. The reference is cross service,
    // so it is validated in application code.
    await queryRunner.query(
      `CREATE INDEX "ix_lines_item" ON "list_lines" ("itemId") WHERE "itemId" IS NOT NULL`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "list_lines"."itemId" IS 'Opaque reference to a catalog Item (plan 0012). Validated in application code, never a database foreign key: catalog is a separate service with its own database.'`
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

    // A merge reassigns one zone's data from a source account to a target account
    // on owner approval; the row records who requested it and who resolved it
    // (plan 0008).
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

    // The inbox that makes the `user.deleted` handler idempotent (plan 0011).
    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "key" varchar NOT NULL,
        "processedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_processed_events" PRIMARY KEY ("key")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP TABLE "merge_requests"`);
    await queryRunner.query(`DROP TABLE "line_comments"`);
    await queryRunner.query(`DROP TABLE "list_lines"`);
    await queryRunner.query(`DROP TABLE "list_access"`);
    await queryRunner.query(`DROP TABLE "shopping_lists"`);
    await queryRunner.query(`DROP TABLE "zone_memberships"`);
    await queryRunner.query(`DROP TABLE "zones"`);
    await queryRunner.query(`DROP TYPE "merge_request_status"`);
    await queryRunner.query(`DROP TYPE "line_status"`);
    await queryRunner.query(`DROP TYPE "line_approval_status"`);
    await queryRunner.query(`DROP TYPE "list_role"`);
    await queryRunner.query(`DROP TYPE "membership_status"`);
    await queryRunner.query(`DROP TYPE "zone_role"`);
    await queryRunner.query(`DROP TYPE "zone_status"`);
  }
}
