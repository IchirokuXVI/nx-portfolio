import { GeneratedLineOrigin } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GeneratedList } from './generated-list.entity';

/**
 * One line of a basket (plan 0050, section 1).
 *
 * The text and the quantity are **copies** taken at generation time, not a view
 * over the zone lines that fed them. Section 4 argues the case: a shopping list
 * that rewrites itself while you are in the shop is hostile, and the zone list
 * stays available for anyone who wants the live truth. The provenance rows carry
 * `lineVersion` precisely so a later read can tell that an origin has moved.
 *
 * ## `itemId` is the pick
 *
 * The exact product this line means to buy: defaulted at generation to the best
 * priced of the line's options at the run's scopes, switchable to any other one
 * (section 5), and what a settlement records (plan 0047, section 3.2). Null for a
 * free text line, which has no product identity and so has no pick to make.
 *
 * ## `settledQuantity` rather than a count over settlements
 *
 * Brought forward from plan 0051 section 6, because plan 0047 made settling
 * cumulative: outstanding is `quantity - settledQuantity`, the screen shows both,
 * and a line is finished when they are equal. It is a column and not a sum over
 * `line_settlements` for two reasons. It is read on every row of the main screen,
 * and a `NOT_AVAILABLE` outcome closes the outstanding amount while contributing
 * no bought units, so there would be nothing to sum.
 */
@Entity({ name: 'generated_list_lines' })
@Index('ix_generated_list_lines_list', ['generatedListId', 'position'])
export class GeneratedListLine extends BaseEntity {
  @Column({ type: 'uuid' })
  generatedListId!: string;

  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'generatedListId' })
  generatedList!: GeneratedList;

  /** The text as shown, copied at generation time. */
  @Column({ type: 'varchar' })
  content!: string;

  /** How many the basket asks for, summed across the origins. */
  @Column({ type: 'int', default: 1 })
  quantity!: number;

  /** How many have been settled so far. Outstanding is the difference. */
  @Column({ type: 'int', default: 0 })
  settledQuantity!: number;

  /**
   * The pick: the exact product this line means to buy. An opaque catalog id,
   * checked for shape in application code and never a foreign key, exactly as
   * `ListLineItem.itemId` is.
   */
  @Index('ix_generated_list_lines_item', { where: '"itemId" IS NOT NULL' })
  @Column({ type: 'uuid', nullable: true })
  itemId!: string | null;

  @Column({
    type: 'enum',
    enum: GeneratedLineOrigin,
    default: GeneratedLineOrigin.DERIVED,
  })
  origin!: GeneratedLineOrigin;

  /**
   * The zone list an `ADDED` line was also written into (section 5).
   *
   * Only ever set on an `ADDED` line: a `DERIVED` one is already in the lists its
   * origins name, and giving it a target would be asking for a second copy of
   * itself.
   */
  @Column({ type: 'uuid', nullable: true })
  targetListId!: string | null;

  @Column({ type: 'double precision', default: 0 })
  position!: number;

  /**
   * Who **put this line here**, written once and never afterwards (plan 0055,
   * section 4).
   *
   * A second column beside {@link lastEditedByParticipantId} rather than a reuse
   * of it, because that one moves: the moment anybody settles the line, or edits
   * its quantity, or swaps its product, it becomes them. "Who put this on the
   * list" is the question a shop full of people actually asks about a line
   * nobody recognises, and after one settle the other column cannot answer it.
   *
   * Null for every line the run composed, which is honest rather than missing: a
   * `DERIVED` line was put there by the generation, and the person who ran the
   * generation is the owner, who is already named on the basket.
   */
  @Column({ type: 'uuid', nullable: true })
  createdByParticipantId!: string | null;

  /**
   * Who touched this line last, written by every edit and every settle (plan
   * 0051, section 8).
   *
   * This is what answers "who got the bread" at a glance in a shop where four
   * people are working through one list, and it is **one column rather than a
   * join into an event log** because it is read on every row of the main screen.
   *
   * A participant rather than a user, for the reason section 3.2 gives: a guest
   * has no user id, and the owner's participant row exists from generation time
   * precisely so this can be a single foreign key rather than a nullable pair.
   *
   * Null on a line nobody has touched since the run composed it, which is every
   * line of a basket that has not been shopped yet.
   */
  @Column({ type: 'uuid', nullable: true })
  lastEditedByParticipantId!: string | null;

  /** When that happened. Null alongside a null participant, never on its own. */
  @Column({ type: 'timestamptz', nullable: true })
  lastEditedAt!: Date | null;
}
