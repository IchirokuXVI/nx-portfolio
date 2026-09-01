import { SettlementOutcome } from '@portfolio/luna-shopper/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ListLine } from './list-line.entity';

/**
 * One origin line, touched by one settling act (plan 0047, section 3).
 *
 * It is the record that makes every history, every indicator and every estimate
 * on the line page computable, and none of them are computable without it. A zone
 * line stopped carrying a trip status here, so what happened on a trip has to
 * live somewhere that a trip is the right scope for.
 *
 * Named for what it is. Most rows are purchases and the screen calls the
 * `BOUGHT` subset "buy history", but a row saying "we tried and the shop did not
 * have it" is not a purchase, and naming the table after the happy case would
 * make the other outcome look like a special case of it.
 *
 * It does not extend `BaseEntity`: a settlement is written once and never edited,
 * so an `updatedAt` on it would be a column that never changes, and its own
 * {@link settledAt} is the time that matters rather than the row's creation.
 */
@Entity({ name: 'line_settlements' })
// The line page's own history, newest first (section 6.1).
@Index('ix_settlements_line', ['lineId', 'settledAt'])
// The cross list item history (section 6.2), which is what the copied `itemId`
// below is for: it is answerable from this index rather than from a join through
// lines whose product set may have moved since.
@Index('ix_settlements_item', ['itemId', 'settledAt'])
// A list scoped read needs no join, which is what `listId` is denormalized for.
@Index('ix_settlements_list', ['listId', 'settledAt'])
export class LineSettlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  /**
   * The line's list, copied so a list scoped read needs no join (section 3).
   *
   * A line never moves between lists, so this cannot drift from what the join
   * would say.
   */
  @Column({ type: 'uuid' })
  listId!: string;

  /**
   * **The exact product that was bought**, copied at settle time (section 3.2).
   *
   * Not a join through the line's product set, because a zone line carries a
   * whole set and the set can change afterwards: the settlement does not move
   * with it. Null for a free text line, and for a caller that did not say which
   * of several products it was.
   *
   * Opaque, like every other catalog reference in core: a uuid checked for shape
   * in application code and never a foreign key, since catalog is a separate
   * service with its own database.
   */
  @Column({ type: 'uuid', nullable: true })
  itemId!: string | null;

  @Column({ type: 'enum', enum: SettlementOutcome })
  outcome!: SettlementOutcome;

  /**
   * The units bought, and `0` for `NOT_AVAILABLE`.
   *
   * It is what was bought and not what was owed (section 4.2): buying three of a
   * line that says two records three, because the extra unit is real and belongs
   * in the consumption history even though it had no demand to satisfy.
   */
  @Column({ type: 'int' })
  quantity!: number;

  /**
   * Who settled it.
   *
   * Non nullable, because without baskets the only people who can settle are
   * account holders with access to the list. Plan 0051 introduces guests, who
   * settle and are not users; it makes this column nullable and adds
   * `settledByParticipantId` beside it with exactly one of the two set (section
   * 3.3). That migration belongs to that plan and is named here only so the shape
   * is not a surprise.
   */
  @Column({ type: 'uuid' })
  settledByUserId!: string;

  @Column({ type: 'timestamptz' })
  settledAt!: Date;

  /**
   * The basket line this came off, when it came off one (plan 0051).
   *
   * Written by nothing in plan 0047, where every settle comes straight from the
   * list page and this is null. It is stored and **never served**: the basket is
   * private and the purchase is not, so a reader learns that something was bought
   * and never which basket it came out of (section 3.1).
   */
  @Column({ type: 'uuid', nullable: true })
  generatedListLineId!: string | null;

  /**
   * What was actually paid, and where (section 3.4).
   *
   * Declared and written by nothing here. They are what "the price you actually
   * paid" and "where you got it" will fill in once backlog 0004 exists, and both
   * are cheap to declare now and a migration each to add later on a table that
   * will by then be the largest in core.
   */
  @Column({ type: 'int', nullable: true })
  pricePaidCents!: number | null;

  @Column({ type: 'uuid', nullable: true })
  supermarketLocationId!: string | null;
}
