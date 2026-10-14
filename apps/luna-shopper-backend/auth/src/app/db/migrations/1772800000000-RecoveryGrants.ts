import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a reset grant was made and how it ended (plan 0210, target state 1):
 * three columns on `password_resets`.
 *
 * It only adds. Every existing row reads as `SELF_SERVICE`, which is the only
 * way a grant could be made before this plan, with no operator and a null
 * `spentAs`, which is honest for a row spent before anybody recorded how. So it
 * is a migration and not a release task: nothing a person or a run wrote is
 * read, changed or deleted.
 *
 * The values are checked here rather than left to the service, as the guest
 * rule of `UserRoles` is: a grant an operator made names the operator, and a
 * self service one names nobody. `issuedByAdminId` has no foreign key, as
 * `auth_audit.actorId` has none, so the row outlives the admin it names.
 *
 * No index is added. The one new query, ending the other live grants of an
 * account, filters on `userId`, which `ix_password_resets_user` already covers.
 */
export class RecoveryGrants1772800000000 implements MigrationInterface {
  name = 'RecoveryGrants1772800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_resets" ADD "channel" varchar NOT NULL DEFAULT 'SELF_SERVICE'`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" ADD "issuedByAdminId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" ADD "spentAs" varchar`
    );
    await queryRunner.query(`
      ALTER TABLE "password_resets" ADD CONSTRAINT "ck_password_resets_channel"
        CHECK ("channel" IN ('SELF_SERVICE', 'OPERATOR_EMAIL', 'OPERATOR_LINK'))
    `);
    await queryRunner.query(`
      ALTER TABLE "password_resets" ADD CONSTRAINT "ck_password_resets_operator"
        CHECK (("channel" = 'SELF_SERVICE') = ("issuedByAdminId" IS NULL))
    `);
    await queryRunner.query(`
      ALTER TABLE "password_resets" ADD CONSTRAINT "ck_password_resets_spent_as"
        CHECK (
          "spentAs" IS NULL
          OR ("consumedAt" IS NOT NULL
            AND "spentAs" IN ('RESET', 'SIGN_IN', 'ALREADY_SIGNED_IN', 'SUPERSEDED'))
        )
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "password_resets"."spentAs" IS
        'How the grant ended (plan 0210). Written by the statement that sets consumedAt. Null while live, and on rows spent before plan 0210.'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP CONSTRAINT "ck_password_resets_spent_as"`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP CONSTRAINT "ck_password_resets_operator"`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP CONSTRAINT "ck_password_resets_channel"`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP COLUMN "spentAs"`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP COLUMN "issuedByAdminId"`
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP COLUMN "channel"`
    );
  }
}
