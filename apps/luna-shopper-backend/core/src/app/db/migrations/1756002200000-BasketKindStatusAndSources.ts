import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A basket has a kind, three statuses and its sources in a table (plan 0133,
 * section 8).
 *
 * Everything below runs inside the one transaction `migrate.ts` opens, and it is
 * written so that it can: both enum types are **created new** rather than having
 * a value added to an existing one, which Postgres will not let a transaction do
 * and then use.
 *
 * ## What it changes
 *
 * - `kind`, over the new type `basket_kind`. Every basket that exists was made
 *   on purpose, so the backfill is `GENERATED` for all of them and the column
 *   default is dropped afterwards, which makes an insert that forgets the kind
 *   fail rather than guess.
 * - `status`, rebuilt as `basket_status` with three values. `DRAFT` and `ACTIVE`
 *   were one state with two spellings and both become `OPEN`, `COMPLETED`
 *   becomes `FINISHED`, and `ARCHIVED` stays.
 * - `pricingProfileId`, lifted out of the snapshot into its own column.
 * - `basket_sources`, backfilled from the snapshot, and the snapshot dropped.
 * - The two constraints that make the permanent basket of plan 0136 a fact of
 *   the database: one `LIVE` row a person, and a `LIVE` row that is unnamed,
 *   open and composed by no run.
 *
 * ## Every backfilled source row names a list
 *
 * `sourceSnapshot.sources` recorded the lists a run **resolved**, never the
 * sources it was asked for (plan 0133, Context), so whether an old run asked for
 * a whole zone is not recoverable from it. An old basket therefore starts with
 * one row per list and does not follow a list added to one of its zones
 * afterwards. That is the honest reading of what was stored, and the alternative
 * would be inventing a whole zone source the request may never have named.
 *
 * ## Going down is lossy, in four stated ways
 *
 * `ACTIVE` does not come back, because nothing ever read it. `profileId` comes
 * back null, because the column that replaced the snapshot records the pricing
 * profile alone. A whole zone source comes back as the lists that zone holds at
 * that moment, which is exactly what the snapshot would have stored. And every
 * `LIVE` basket is **deleted**, because the earlier schema has no way to say what
 * one is; its participants, links, lines and sources go with it by cascade.
 */
export class BasketKindStatusAndSources1756002200000 implements MigrationInterface {
  name = 'BasketKindStatusAndSources1756002200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. The kind. Defaulted for the backfill, then undefaulted, so that every
    //    existing row is `GENERATED` and every future insert has to say.
    await queryRunner.query(
      `CREATE TYPE "basket_kind" AS ENUM ('LIVE', 'GENERATED')`
    );
    await queryRunner.query(`
      ALTER TABLE "generated_lists"
        ADD COLUMN "kind" "basket_kind" NOT NULL DEFAULT 'GENERATED'
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ALTER COLUMN "kind" DROP DEFAULT
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_lists"."kind" IS
        'What this basket is (plan 0133). GENERATED is a trip somebody composed; LIVE is the permanent basket, one per person, which never ends.'
    `);

    // 2. The status, as a new type. The default is dropped first, because a
    //    default of the old type blocks the column's type change.
    await queryRunner.query(
      `CREATE TYPE "basket_status" AS ENUM ('OPEN', 'FINISHED', 'ARCHIVED')`
    );
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists"
        ALTER COLUMN "status" TYPE "basket_status"
        USING (
          CASE "status"::text
            WHEN 'DRAFT' THEN 'OPEN'
            WHEN 'ACTIVE' THEN 'OPEN'
            WHEN 'COMPLETED' THEN 'FINISHED'
            ELSE 'ARCHIVED'
          END
        )::"basket_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ALTER COLUMN "status" SET DEFAULT 'OPEN'
    `);
    await queryRunner.query(`DROP TYPE "generated_list_status"`);

    // 3. The pricing profile, out of the snapshot and into a column. `NULLIF`
    //    because a key absent from the `jsonb` and a key holding an empty string
    //    both mean "this run was composed before plan 0078".
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ADD COLUMN "pricingProfileId" uuid NULL
    `);
    await queryRunner.query(`
      UPDATE "generated_lists"
      SET "pricingProfileId" =
        NULLIF("sourceSnapshot"->>'pricingProfileId', '')::uuid
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_lists"."pricingProfileId" IS
        'The profile this basket is priced against (plan 0078), moved here from the snapshot by plan 0133. Null on a run composed before plan 0078 and on every LIVE basket.'
    `);

    // 4. The sources table. Foreign keys where the origins table has none: an
    //    origin is history and outlives what it names, a source is a rule that
    //    is evaluated today and says nothing once its list is gone.
    await queryRunner.query(`
      CREATE TABLE "basket_sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "basketId" uuid NOT NULL,
        "zoneId" uuid NOT NULL,
        "listId" uuid NULL,
        CONSTRAINT "pk_basket_sources" PRIMARY KEY ("id"),
        CONSTRAINT "fk_basket_sources_basket" FOREIGN KEY ("basketId")
          REFERENCES "generated_lists"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_basket_sources_zone" FOREIGN KEY ("zoneId")
          REFERENCES "zones"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_basket_sources_list" FOREIGN KEY ("listId")
          REFERENCES "shopping_lists"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "basket_sources" IS
        'What a basket was asked to draw from, as it was named (plan 0133). A null listId means every list of the zone the owner can write.'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_basket_sources_zone"
        ON "basket_sources" ("basketId", "zoneId") WHERE "listId" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_basket_sources_list"
        ON "basket_sources" ("basketId", "listId") WHERE "listId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_basket_sources_list"
        ON "basket_sources" ("listId") WHERE "listId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_basket_sources_zone"
        ON "basket_sources" ("zoneId") WHERE "listId" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_basket_sources_basket" ON "basket_sources" ("basketId")
    `);

    // 5. The backfill. The two joins drop a source whose zone or list is gone,
    //    which the foreign keys would refuse anyway, and `DISTINCT` drops a
    //    snapshot that happened to name the same list twice.
    await queryRunner.query(`
      INSERT INTO "basket_sources" ("basketId", "zoneId", "listId")
      SELECT DISTINCT gl.id, (s->>'zoneId')::uuid, (s->>'listId')::uuid
      FROM "generated_lists" gl
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(gl."sourceSnapshot"->'sources', '[]'::jsonb)
      ) s
      JOIN "zones" z ON z.id = (s->>'zoneId')::uuid
      JOIN "shopping_lists" sl ON sl.id = (s->>'listId')::uuid
    `);

    // 6. The snapshot goes.
    await queryRunner.query(`
      ALTER TABLE "generated_lists" DROP COLUMN "sourceSnapshot"
    `);

    // 7. What a LIVE basket is, held by the database (section 2). Added last,
    //    so that no step above has to satisfy them while it works.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_generated_lists_live_owner"
        ON "generated_lists" ("ownerUserId") WHERE "kind" = 'LIVE'
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists"
        ADD CONSTRAINT "ck_generated_lists_live_shape" CHECK (
          "kind" <> 'LIVE'
          OR (
            "name" IS NULL
            AND "status" = 'OPEN'
            AND "idempotencyKey" IS NULL
          )
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_lists"
        DROP CONSTRAINT IF EXISTS "ck_generated_lists_live_shape"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_generated_lists_live_owner"`
    );

    // The earlier schema cannot say what a permanent basket is, so it goes, and
    // its lines, sources, participants and links go with it by cascade. Stated
    // rather than hidden: it is the one step here that deletes a row.
    await queryRunner.query(
      `DELETE FROM "generated_lists" WHERE "kind" = 'LIVE'`
    );

    // The snapshot, rebuilt from the table. `profileId` comes back null, because
    // the column that replaced it records the pricing profile alone, and a whole
    // zone source comes back as the lists that zone holds at this moment, which
    // is what the snapshot stored in the first place.
    await queryRunner.query(`
      ALTER TABLE "generated_lists"
        ADD COLUMN "sourceSnapshot" jsonb NOT NULL DEFAULT '{}'
    `);
    await queryRunner.query(`
      UPDATE "generated_lists" gl
      SET "sourceSnapshot" = jsonb_build_object(
        'profileId', NULL,
        'pricingProfileId', to_jsonb(gl."pricingProfileId"),
        'sources', COALESCE(
          (
            SELECT jsonb_agg(
              DISTINCT jsonb_build_object(
                'zoneId', e."zoneId"::text,
                'listId', e."listId"::text
              )
            )
            FROM (
              SELECT bs."zoneId" AS "zoneId", sl.id AS "listId"
              FROM "basket_sources" bs
              JOIN "shopping_lists" sl
                ON sl."zoneId" = bs."zoneId"
               AND (bs."listId" IS NULL OR sl.id = bs."listId")
              WHERE bs."basketId" = gl.id
            ) e
          ),
          '[]'::jsonb
        )
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ALTER COLUMN "sourceSnapshot" DROP DEFAULT
    `);

    await queryRunner.query(`DROP TABLE "basket_sources"`);
    await queryRunner.query(`
      ALTER TABLE "generated_lists" DROP COLUMN "pricingProfileId"
    `);

    // `ACTIVE` does not come back: nothing ever wrote it, so no row could be
    // restored to it honestly.
    await queryRunner.query(`
      CREATE TYPE "generated_list_status" AS ENUM (
        'DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists"
        ALTER COLUMN "status" TYPE "generated_list_status"
        USING (
          CASE "status"::text
            WHEN 'OPEN' THEN 'DRAFT'
            WHEN 'FINISHED' THEN 'COMPLETED'
            ELSE 'ARCHIVED'
          END
        )::"generated_list_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_lists" ALTER COLUMN "status" SET DEFAULT 'DRAFT'
    `);
    await queryRunner.query(`DROP TYPE "basket_status"`);

    await queryRunner.query(`
      ALTER TABLE "generated_lists" DROP COLUMN "kind"
    `);
    await queryRunner.query(`DROP TYPE "basket_kind"`);
  }
}
