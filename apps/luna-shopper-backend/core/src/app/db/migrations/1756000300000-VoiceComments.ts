import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A comment can carry a recording (plan 0045).
 *
 * Two things land together because they are one feature: four nullable columns on
 * `line_comments` describing a recording, and `comment_audio` holding the bytes.
 * Doing it in one migration takes one lock on `line_comments` rather than two.
 *
 * ## Nothing backfills, and nothing needs to
 *
 * Every column added here is nullable with no default, and null is the honest
 * value for every comment that already exists: they are all typed, none has a
 * recording, and none has a transcript. So this migration rewrites no rows and
 * takes no long lock, which matters because `line_comments` is the table behind
 * the busiest read in the product.
 *
 * `transcription` is `text` rather than a Postgres enum, unlike `list_permission`
 * next door. The reason is which side owns the value: a permission is a stored
 * grant that the database itself constrains and that a migration has had to
 * rewrite in place, whereas this is a state the application moves a row through
 * within seconds of creating it. An enum would buy a type to alter every time a
 * state is added and would give nothing back, since a row in a state core does
 * not recognise is a row core wrote.
 *
 * ## `bytea`, in its own table, keyed on the comment
 *
 * Section 2 of the plan is the argument and it is not repeated here beyond the two
 * things a reader of this file needs: the bytes are out of `line_comments` so they
 * are never in the listing query's way, and the row cascades from the comment so
 * deleting a line takes its comments and their recordings by the chain that
 * already exists. Account deletion (plan 0011) reaches them the same way.
 *
 * There is deliberately **no index** on `comment_audio` beyond its primary key.
 * It is read one row at a time, by primary key, from one route.
 */
export class VoiceComments1756000300000 implements MigrationInterface {
  name = 'VoiceComments1756000300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The metadata a listing draws a player from. All four nullable, because a
    // typed comment has none of them and there are a lot of typed comments.
    await queryRunner.query(
      `ALTER TABLE "line_comments" ADD "audioContentType" text`
    );
    await queryRunner.query(
      `ALTER TABLE "line_comments" ADD "audioByteLength" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "line_comments" ADD "audioDurationSeconds" real`
    );
    await queryRunner.query(
      `ALTER TABLE "line_comments" ADD "transcription" text`
    );

    await queryRunner.query(`
      CREATE TABLE "comment_audio" (
        "commentId" uuid NOT NULL,
        "contentType" text NOT NULL,
        "audio" bytea NOT NULL,
        CONSTRAINT "pk_comment_audio" PRIMARY KEY ("commentId"),
        CONSTRAINT "fk_comment_audio_comment" FOREIGN KEY ("commentId")
          REFERENCES "line_comments" ("id") ON DELETE CASCADE
      )
    `);
  }

  /**
   * Lossy, and there is no version of it that is not: dropping the table drops
   * every recording anybody left. That is stated here rather than hidden, and it
   * is the ordinary cost of rolling back a feature whose whole content is new.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "comment_audio"`);
    await queryRunner.query(
      `ALTER TABLE "line_comments" DROP COLUMN "transcription"`
    );
    await queryRunner.query(
      `ALTER TABLE "line_comments" DROP COLUMN "audioDurationSeconds"`
    );
    await queryRunner.query(
      `ALTER TABLE "line_comments" DROP COLUMN "audioByteLength"`
    );
    await queryRunner.query(
      `ALTER TABLE "line_comments" DROP COLUMN "audioContentType"`
    );
  }
}
