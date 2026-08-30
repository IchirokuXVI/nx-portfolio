import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { LineComment } from './line-comment.entity';

/**
 * The bytes of a voice comment (plan 0045, section 2).
 *
 * **The first thing this backend keeps that is not text**, and the decision it
 * embodies is `bytea` in core's own database rather than object storage: no
 * StatefulSet, no PVC, no credential in `provision-release.sh`, no second entry in
 * both values files and both compose files, no second backup story, and no second
 * thing that can be up while the other is down. If the database is down, comments
 * are down anyway.
 *
 * The arithmetic behind that, so it is a decision and not a hope: speech grade
 * Opus is roughly two kilobytes a second, so a sixty second message is about
 * 120 KB, and a household leaving two hundred voice comments a year costs about
 * twenty five megabytes a year. The number that would change the answer is three
 * orders of magnitude away.
 *
 * ## Why it is its own table
 *
 * `line_comments` stays a narrow row that is selected in every comment listing,
 * and the bytes are never in that query's way. A `bytea` column on the comment
 * itself would put the audio into the `SELECT *` path of a paged endpoint, which
 * is precisely how this decision would turn bad quickly. Nothing selects this
 * table except the playback route; everything a listing needs (the length, the
 * content type, whether a recording exists) lives on the comment.
 *
 * The metadata is duplicated here rather than only on the comment because this
 * row has to be self describing when it is fetched on its own: the playback route
 * reads exactly one row and must know what to put in `Content-Type` without a
 * second query.
 *
 * ## When to move it
 *
 * If the table passes a few gigabytes, or a second thing in this product needs to
 * store a file, **this row is the seam**: it becomes a key into something else and
 * the playback route is the only thing that changes. That is a deliberate exit,
 * not a promise to refactor.
 */
@Entity({ name: 'comment_audio' })
export class CommentAudio {
  /**
   * The comment's own id, as this table's primary key.
   *
   * One to one keyed on the comment rather than a surrogate id of its own,
   * because a comment has exactly one recording or none and a second row would be
   * a state nothing in this product can produce or read.
   */
  @PrimaryColumn({ type: 'uuid' })
  commentId!: string;

  @OneToOne(() => LineComment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment!: LineComment;

  @Column({ type: 'text' })
  contentType!: string;

  @Column({ type: 'bytea' })
  audio!: Buffer;
}
