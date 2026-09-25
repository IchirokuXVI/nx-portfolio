import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A link that lasts twelve hours, and a visitor whose access does too (plan
 * 0140, section 9).
 *
 * Two tables gain the same idea from two directions. A share link always has an
 * end, and everybody a link let in has one on their own row.
 *
 * ## The participant expiry is a column and not a lookup
 *
 * The hot path is one indexed lookup that never reads the link (plan 0051,
 * section 3.3). Copying the expiry onto the participant at join is what lets
 * "live" gain a clock without gaining a join, which is why this is a column here
 * rather than a rule about the link.
 *
 * `ck_generated_list_participants_expiry` is the product owner's rule written as
 * a constraint: the owner and a person added by name never expire, and everybody
 * else always does. "Keeping access means being added by name" is exactly that
 * equivalence.
 *
 * ## The backfill, and who loses access
 *
 * Every live visitor gets twelve hours from the deploy, and every ended row
 * keeps its own `revokedAt`, which is when its access actually stopped. The
 * literal twelve hours is written out because a migration cannot read
 * `BASKET_LINK_TTL`; the number is the same one, and a later change to the
 * configuration does not rewrite these rows.
 *
 * Nobody is kept. A visitor the owner meant to keep and one they forgot look
 * identical in these rows, so no intent can be recovered from them, and the
 * owner adds by name whoever they want back. The grace is there so that a deploy
 * during somebody's shop does not end it.
 *
 * Every link older than twelve hours stops accepting joins at the deploy, which
 * is nearly all of them. The share sheet then shows "Share" again, and pressing
 * it mints a fresh link.
 *
 * ## No enum is involved
 *
 * `endedReason` is a `varchar` behind a check constraint, so adding `EXPIRED` is
 * dropping and recreating that constraint rather than an `ALTER TYPE`.
 */
export class BasketLinkAndAccessExpiry1756002800000
  implements MigrationInterface
{
  name = 'BasketLinkAndAccessExpiry1756002800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD COLUMN "expiresAt" timestamptz NULL
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."expiresAt" IS
        'When this person''s access ends by itself (plan 0140, section 2). Null exactly for the owner and for a person the owner added by name. Every comparison against it is the database''s now().'
    `);

    // A live visitor keeps working for twelve more hours, so a deploy during
    // somebody's shop does not end it. An ended row gets the moment its access
    // actually stopped, which is what makes the constraint below hold over it
    // without inventing a future for a row that has none.
    await queryRunner.query(`
      UPDATE "generated_list_participants"
        SET "expiresAt" = COALESCE("revokedAt", now() + interval '12 hours')
        WHERE "kind" <> 'OWNER' AND "invitedAt" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD CONSTRAINT "ck_generated_list_participants_expiry" CHECK (
          ("kind" = 'OWNER' OR "invitedAt" IS NOT NULL) = ("expiresAt" IS NULL)
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        DROP CONSTRAINT IF EXISTS "ck_generated_list_participants_ended_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD CONSTRAINT "ck_generated_list_participants_ended_reason" CHECK (
          "endedReason" IS NULL
          OR "endedReason" IN ('REMOVED', 'LINK_REVOKED', 'LEFT', 'EXPIRED')
        )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_participants"."endedReason" IS
        'Why this row stopped being live: REMOVED, LINK_REVOKED, LEFT or EXPIRED (plan 0140, section 7). Set together with "revokedAt". LEFT and EXPIRED both let the link bring the person back.'
    `);

    // The sweep reads the expired rows oldest first, and nothing else reads this
    // shape, so the index is exactly its predicate.
    await queryRunner.query(`
      CREATE INDEX "ix_generated_list_participants_expiring"
        ON "generated_list_participants" ("expiresAt")
        WHERE "revokedAt" IS NULL AND "expiresAt" IS NOT NULL
    `);

    // Every existing link, including one minted with a thirty day expiry and one
    // minted with none, becomes twelve hours from when it was created. Nearly
    // all of them are therefore dead at the deploy, which is the point.
    await queryRunner.query(`
      UPDATE "generated_list_share_links"
        SET "expiresAt" = "createdAt" + interval '12 hours'
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_share_links"
        ALTER COLUMN "expiresAt" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_share_links"
        ADD CONSTRAINT "ck_generated_list_share_links_expiry" CHECK (
          "expiresAt" > "createdAt"
        )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "generated_list_share_links"."expiresAt" IS
        'When the invitation stops accepting people: createdAt plus BASKET_LINK_TTL, twelve hours (plan 0140, section 4). Never null, and no caller may name it.'
    `);
  }

  /**
   * Lossy in two ways, and both are stated rather than worked around.
   *
   * The thirty day expiries this replaced are not restored: the number they were
   * computed from is gone from the rows. And every visitor becomes permanent
   * again, because that is what the schema before this migration meant.
   *
   * `EXPIRED` becomes `LEFT`, the one earlier reason that also lets the person
   * come back through a link, so a row ended by the clock keeps meaning what it
   * meant rather than becoming a removal.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "generated_list_share_links"
        DROP CONSTRAINT IF EXISTS "ck_generated_list_share_links_expiry"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_share_links"
        ALTER COLUMN "expiresAt" DROP NOT NULL
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "ix_generated_list_participants_expiring"`
    );
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        DROP CONSTRAINT IF EXISTS "ck_generated_list_participants_expiry"
    `);

    await queryRunner.query(`
      UPDATE "generated_list_participants"
        SET "endedReason" = 'LEFT'
        WHERE "endedReason" = 'EXPIRED'
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        DROP CONSTRAINT IF EXISTS "ck_generated_list_participants_ended_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        ADD CONSTRAINT "ck_generated_list_participants_ended_reason" CHECK (
          "endedReason" IS NULL
          OR "endedReason" IN ('REMOVED', 'LINK_REVOKED', 'LEFT')
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "generated_list_participants"
        DROP COLUMN IF EXISTS "expiresAt"
    `);
  }
}
