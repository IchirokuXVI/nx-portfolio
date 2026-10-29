import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each person's assistant allowance (plan 0234, section 4).
 *
 * Three new tables and nothing else: one usage row per person per day, one per
 * deployment per day, and the open reservations. It reads and writes no
 * existing row, adds no enum and extends none, so the single transaction
 * `migrate.ts` runs everything in is no obstacle.
 *
 * **The month is a sum**, of a person's rows whose `day` falls in it, read
 * through the primary key. At most 31 rows per person, and no monthly table to
 * keep in step.
 *
 * **No foreign key to a user.** Core holds no user table; the account
 * deletion of plan 0232 deletes the person's rows by user id.
 *
 * Column names are camelCase in quotes like every other core table, where the
 * plan's sketch wrote them in snake case. Two more departures from the sketch:
 * the reserved audio is two columns, one for assistant audio and one for
 * comment audio, because a check of one must not count a reservation of the
 * other; and the reservation's purpose is `purpose`, the word the request uses,
 * rather than `kind`, which the gateway already means as `UserKind`.
 *
 * `down` drops the three tables, which loses every count. The assistant fails
 * closed without them, so a `down` is a deployment with no assistant until
 * `up` runs again.
 */
export class AssistantAllowance1756004000000 implements MigrationInterface {
  name = 'AssistantAllowance1756004000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "assistant_usage_days" (
        "userId" uuid NOT NULL,
        "day" date NOT NULL,
        "turns" integer NOT NULL DEFAULT 0,
        "assistantAudioSeconds" integer NOT NULL DEFAULT 0,
        "commentAudioSeconds" integer NOT NULL DEFAULT 0,
        "costMicroUsd" bigint NOT NULL DEFAULT 0,
        "promptTokens" bigint NOT NULL DEFAULT 0,
        "responseTokens" bigint NOT NULL DEFAULT 0,
        "cachedPromptTokens" bigint NOT NULL DEFAULT 0,
        "reservedTurns" integer NOT NULL DEFAULT 0,
        "reservedAssistantAudioSeconds" integer NOT NULL DEFAULT 0,
        "reservedCommentAudioSeconds" integer NOT NULL DEFAULT 0,
        "reservedMicroUsd" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "pk_assistant_usage_days" PRIMARY KEY ("userId", "day")
      )
    `);
    // The retention sweep deletes by day across every person.
    await queryRunner.query(`
      CREATE INDEX "ix_assistant_usage_days_day"
        ON "assistant_usage_days" ("day")
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "assistant_usage_days" IS
        'What one person used of the assistant on one day, in the deployment''s allowance timezone (plan 0234). Money is integer micro dollars. The reserved columns hold what open reservations hold.'
    `);

    await queryRunner.query(`
      CREATE TABLE "assistant_usage_deployment_days" (
        "day" date NOT NULL,
        "costMicroUsd" bigint NOT NULL DEFAULT 0,
        "reservedMicroUsd" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "pk_assistant_usage_deployment_days" PRIMARY KEY ("day")
      )
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "assistant_usage_deployment_days" IS
        'What the whole deployment spent on the assistant on one day (plan 0234). Holds no person, and is kept 13 months as the operator''s record of the bill.'
    `);

    await queryRunner.query(`
      CREATE TABLE "assistant_reservations" (
        "id" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "day" date NOT NULL,
        "purpose" text NOT NULL,
        "turns" integer NOT NULL,
        "audioSeconds" integer NOT NULL,
        "microUsd" bigint NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_assistant_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "ck_assistant_reservations_purpose"
          CHECK ("purpose" IN ('TURN', 'VOICE_TURN', 'TRANSCRIPTION'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_assistant_reservations_expires"
        ON "assistant_reservations" ("expiresAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_assistant_reservations_user"
        ON "assistant_reservations" ("userId")
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "assistant_reservations" IS
        'The worst case of a call sequence the assistant is running, held against a person''s allowance until it settles or expires (plan 0234, section 5).'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "assistant_reservations"`);
    await queryRunner.query(`DROP TABLE "assistant_usage_deployment_days"`);
    await queryRunner.query(`DROP TABLE "assistant_usage_days"`);
  }
}
