import { LineApprovalStatus } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingList } from './shopping-list.entity';

/**
 * A line in a shopping list (plan 0007, section 1). `approvalStatus` says whether
 * it belongs on the list, and `version` bumps on each edit to support the
 * last-write-wins reconciliation in 0009.
 *
 * It used to carry a second state machine, `status`, saying where it had got to
 * on a shopping trip. Plan 0047 dropped it: that is a fact about one trip written
 * onto a record that outlives every trip, and it is what made a shared list
 * accumulate ticked lines until people stopped opening it. **{@link quantity} is
 * the state now.** Buying decrements it, zero means the household is stocked, and
 * the line stays exactly where it is until somebody deletes it on purpose. What
 * happened on a trip is a `line_settlements` row.
 *
 * Since plan 0048 the products it stands for are a **set**, in `list_line_items`,
 * summarised here by `itemSetHash`. The single nullable `itemId` it used to carry
 * is gone; it was null on every line ever created.
 */
@Entity({ name: 'list_lines' })
// Serves both line counts, total and wanted (plan 0017, section 4.3; plan 0047,
// section 2.3). It was `(listId, status)` when the second count was "ready".
@Index('ix_lines_list_quantity', ['listId', 'quantity'])
export class ListLine extends BaseEntity {
  @Column({ type: 'uuid' })
  listId!: string;

  @ManyToOne(() => ShoppingList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listId' })
  list!: ShoppingList;

  @Column({ type: 'varchar' })
  content!: string;

  /**
   * How many of this the household wants right now (plan 0047, section 1).
   *
   * Zero is a real, ordinary value: it means stocked, not deleted. Deleting is a
   * separate confirmed gesture and it is the only thing that discards the
   * history (section 2.2).
   */
  @Column({ type: 'int', default: 1 })
  quantity!: number;

  /**
   * A digest of the sorted distinct ids in this line's product set, or null while
   * the set is empty (plan 0048, section 1.1).
   *
   * Recomputed by the service on every write to the set, never by the client and
   * never by the database, so the one algorithm lives in `item-set-hash.ts`. It is
   * what makes two hand made sets holding the same products recognisable as the
   * same set, however the products got there.
   */
  @Index('ix_lines_item_set_hash', { where: '"itemSetHash" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  itemSetHash!: string | null;

  @Column({ type: 'double precision', default: 0 })
  position!: number;

  @Column({
    type: 'enum',
    enum: LineApprovalStatus,
    default: LineApprovalStatus.PENDING,
  })
  approvalStatus!: LineApprovalStatus;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;
}
