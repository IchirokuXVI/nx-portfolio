import { CommentTranscription } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ListLine } from './list-line.entity';

/**
 * A comment on a line (plan 0007, section 1). Comments are listed newest to
 * oldest with a fixed order.
 *
 * Since plan 0045 a comment can be a **recording**, and the three columns that
 * describe one live here rather than on `comment_audio` on purpose: a listing
 * needs to draw a player, say how long it runs and say whether a transcript is
 * still coming, and it must do all three without the bytes entering the query.
 * The bytes are one join away and nothing but the playback route ever takes it.
 */
@Entity({ name: 'line_comments' })
export class LineComment extends BaseEntity {
  @Index('ix_comments_line')
  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  @Column({ type: 'uuid' })
  authorUserId!: string;

  /**
   * The comment's text, which for a voice comment is its transcript.
   *
   * **Empty is a valid comment** since plan 0045 (section 4.2): the audio is the
   * message and the transcript is a reading of it, so a provider that is down
   * costs a transcript and never a message. Every read path holds that, and the
   * client draws a neutral phrase rather than an empty bubble.
   */
  @Column({ type: 'text' })
  body!: string;

  /**
   * What the recording is stored as, or null for a typed comment.
   *
   * Null here is the single test for "is this a voice comment", which is why it
   * is nullable rather than defaulted to an empty string.
   */
  @Column({ type: 'text', nullable: true })
  audioContentType!: string | null;

  /** The stored size, or null for a typed comment. The only number enforced on. */
  @Column({ type: 'integer', nullable: true })
  audioByteLength!: number | null;

  /**
   * What the client claimed the recording lasts, or null.
   *
   * Null for a typed comment and also for a voice comment whose client said
   * nothing. **Never trusted** (plan 0045, section 6): it is metadata for drawing
   * a row before the file is fetched, nothing authorizes on it and nothing
   * rejects on it. The byte count is the enforcement.
   */
  @Column({ type: 'real', nullable: true })
  audioDurationSeconds!: number | null;

  /** How far the transcript got, or null for a typed comment (plan 0045, 4.2). */
  @Column({ type: 'text', nullable: true })
  transcription!: CommentTranscription | null;
}
