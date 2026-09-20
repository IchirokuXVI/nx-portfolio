import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { GeneratedListParticipant } from './generated-list-participant.entity';

/**
 * What one viewer of a basket has seen of its lists' changes (plan 0138, section
 * 5).
 *
 * ## The viewer is a participant
 *
 * Plan 0130, section 11, decision 10. Two phones of one account share a cursor,
 * because they are one person looking; two guests are two participants, because
 * they are two. The row cascades with the participant, so a person who is removed
 * from a basket leaves no cursor behind.
 *
 * ## A table of its own, not three columns on the participant
 *
 * The participant row is read on every request of the hot path, and these three
 * values are read by two routes. Widening the hot row for them would make every
 * settle carry three columns nothing in it looks at.
 *
 * ## Three values, because a mark has two ends
 *
 * A change is **unseen** until this viewer acknowledges it, and then it
 * **lingers**, still drawn, for a window measured from {@link ackedAt} rather
 * than from the change. So a phone that spent the change in a pocket for three
 * hours acknowledges nothing and still shows the mark when it comes out, and a
 * phone with a wrong clock shows it for the right length of time: every
 * comparison is the database's `now()`.
 */
@Entity({ name: 'basket_change_cursors' })
export class BasketChangeCursor {
  /**
   * The viewer, and the primary key: one cursor per participant, which is what
   * makes the acknowledgement an upsert rather than a read and a write.
   */
  @PrimaryColumn({ type: 'uuid' })
  participantId!: string;

  @OneToOne(() => GeneratedListParticipant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participantId' })
  participant!: GeneratedListParticipant;

  /**
   * The start of the window the lingering marks are in: what
   * {@link seenThrough} said before the last acknowledgement.
   *
   * `ck_basket_change_cursors_order` holds `seenFrom <= seenThrough`.
   */
  @Column({ type: 'timestamptz' })
  seenFrom!: Date;

  /**
   * The `createdAt` of the newest change this viewer has acknowledged.
   *
   * Written from the change's own column inside one statement, so the value never
   * passes through JavaScript and loses its microseconds.
   */
  @Column({ type: 'timestamptz' })
  seenThrough!: Date;

  /** When they acknowledged, which is what the mark window is measured from. */
  @Column({ type: 'timestamptz' })
  ackedAt!: Date;
}
