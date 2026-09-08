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

  /**
   * The zone line this purchase is a fact about, or null while it waits for one
   * (plan 0093, section 2).
   *
   * A row with both this and {@link listId} null is a **waiting settlement**: a
   * purchase made on a basket line before that line reached any list. It belongs
   * to the basket line through {@link generatedListLineId} and to no household
   * yet, and it comes home the moment the line reaches a list.
   *
   * Nullable since plan 0093, which reversed plan 0058 section 4.1. Before it, a
   * settle on a line with no origins wrote no row at all, so a shopper who
   * bought four batteries and then sent the line to the flat's list gave the flat
   * a line asking for nothing and a history saying batteries were never bought.
   *
   * The two columns are null **together**, which is `ck_line_settlements_home`
   * rather than a service rule: a row naming a line and no list, or a list and no
   * line, would be a purchase nobody could read by either key.
   */
  @Column({ type: 'uuid', nullable: true })
  lineId!: string | null;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine | null;

  /**
   * The line's list, copied so a list scoped read needs no join (section 3).
   *
   * A line never moves between lists, so this cannot drift from what the join
   * would say. Null exactly when {@link lineId} is, and for the same reason.
   */
  @Column({ type: 'uuid', nullable: true })
  listId!: string | null;

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
   * Who settled it, when an account holder settled it from the list page.
   *
   * Nullable since plan 0051, which introduced people who settle and are not
   * users. Exactly one of this and {@link settledByParticipantId} is set, and
   * that is a check constraint (`ck_line_settlements_actor`) rather than a
   * service rule: a row attributed to both or to neither would be an
   * unattributable purchase in a shared household's history, which is the failure
   * this table exists to prevent.
   */
  @Column({ type: 'uuid', nullable: true })
  settledByUserId!: string | null;

  /**
   * Who settled it, when it was settled from a shared basket (plan 0051,
   * section 6).
   *
   * **Always the participant and never the user on that path**, including when
   * the person settling is the owner with a perfectly good account. Every actor
   * on a basket is a participant (section 3.2), so attributing some basket
   * settles to a user and others to a participant would make "who got the bread"
   * two questions instead of one.
   *
   * No foreign key, and that is not an oversight: a settlement is a **zone fact**
   * and the basket is not, so deleting a basket, or a departing user's account
   * taking their participants with it (plan 0011), must leave the purchase
   * standing with its attribution nulled rather than delete what the household
   * bought.
   */
  @Column({ type: 'uuid', nullable: true })
  settledByParticipantId!: string | null;

  @Column({ type: 'timestamptz' })
  settledAt!: Date;

  /**
   * When somebody took this settlement back, or null while it stands (plan
   * 0054, section 3.3).
   *
   * **A settlement is an append, and a reopen does not delete one.** The row
   * stays, marked, because "somebody said they got this and then took it back"
   * is a truer history than a gap, and because the alternative, a compensating
   * row carrying a negative quantity, would make every existing sum over
   * {@link quantity} wrong until it was taught about signs. A nullable timestamp
   * changes each of those by one `WHERE` clause instead.
   *
   * So a reverted row is excluded from every consumption total and is still
   * served by the settlement history. The partial index the migration adds is
   * what keeps that exclusion off a sequential scan.
   */
  @Column({ type: 'timestamptz', nullable: true })
  revertedAt!: Date | null;

  /**
   * Who took it back, when somebody did (plan 0054, section 3.3).
   *
   * A participant, always, and never a user, for the reason
   * {@link settledByParticipantId} is: a reopen happens on a basket, where every
   * actor is a participant. It carries the same check constraint shape and the
   * same absence of a foreign key, since a settlement is a zone fact that must
   * outlive the basket it came off.
   */
  @Column({ type: 'uuid', nullable: true })
  revertedByParticipantId!: string | null;

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
