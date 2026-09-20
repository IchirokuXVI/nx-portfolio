import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GeneratedList } from './generated-list.entity';
import { ListLine } from './list-line.entity';

/**
 * One basket's "not today" on one covered list line (plan 0137).
 *
 * A shopper can no longer take a line out of a basket. What they say instead is
 * that they are not buying it on this trip, and this is where that is written
 * down: the row stays where it is, is marked as skipped for twelve hours, and
 * then becomes an ordinary row again carrying a note that it was skipped
 * earlier.
 *
 * ## Why it is not a third `SettlementOutcome`
 *
 * A settlement is a household fact, read by every member of the zone. A skip is
 * one shopper's intention for one trip: it is private to the basket, it expires,
 * and other events end it. Plan 0047 section 4 drew that line first, when a
 * skipped settle was made to write nothing at all, and plan 0137 section 7 lists
 * the eight reads that take any outcome and would each need a filter added and
 * remembered the day a third value existed. A read that never heard of this
 * table shows nothing instead, and under inclusion is the safe way to be wrong.
 *
 * ## Append only
 *
 * Shaped after {@link LineSettlement}: written once, taken back with
 * {@link revertedAt} and an actor, never edited otherwise. So "who skipped this
 * and when" is a history rather than a current value, and the one rule that ends
 * a skip without writing here — a purchase through this basket — is a `WHERE`
 * three writers cannot forget (section 3.1).
 *
 * It does not extend `BaseEntity`, for {@link LineSettlement}'s reason:
 * {@link skippedAt} is the time that matters rather than the row's creation, and
 * an `updatedAt` here would be a column that never changes.
 */
@Entity({ name: 'basket_line_skips' })
/**
 * The standing skips of one basket, which is the only way this table is read.
 *
 * **Not unique.** A row can be skipped, bought in part (which ends the skip) and
 * skipped again for the rest, and both rows keep a null `revertedAt`. What stops
 * two standing skips on one line is the lock the write takes over the row's list
 * lines, not the index.
 */
@Index('ix_basket_line_skips_standing', ['basketId', 'lineId'], {
  where: '"revertedAt" IS NULL',
})
export class BasketLineSkip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /**
   * The basket that said it, and the reason this carries a foreign key where a
   * settlement's `basketId` does not.
   *
   * A settlement is a zone fact and outlives the basket it came off, so deleting
   * a basket must leave the purchase standing. A skip means nothing without its
   * basket, so it goes with it.
   */
  @Column({ type: 'uuid' })
  basketId!: string;

  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'basketId' })
  basket!: GeneratedList;

  /** The covered zone line. It cascades too: a skip means nothing without it. */
  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  /**
   * Who said it.
   *
   * No foreign key, as on `line_settlements`: the two participant columns are
   * attribution, a participant row is never deleted apart from its basket, so
   * nothing dangles in practice.
   */
  @Column({ type: 'uuid' })
  skippedByParticipantId!: string;

  /**
   * When they said it, which is what the twelve hour window is measured from.
   *
   * Written as `now()` by the database on every path, so no application server
   * and no device decides whether a row is still skipped.
   */
  @Column({ type: 'timestamptz' })
  skippedAt!: Date;

  /**
   * When somebody took the skip back, or null while it may still stand.
   *
   * Both of these are set together or neither is
   * (`ck_basket_line_skips_revert`), which is the shape
   * `ck_line_settlements_revert` already has in this database.
   */
  @Column({ type: 'timestamptz', nullable: true })
  revertedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  revertedByParticipantId!: string | null;
}
