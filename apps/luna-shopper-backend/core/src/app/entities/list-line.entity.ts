import {
  LineApprovalStatus,
  LineStatus,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingList } from './shopping-list.entity';

/**
 * A line in a shopping list (plan 0007, section 1). It carries two independent
 * state machines: `approvalStatus` (it has to be approved) and `status` (its item
 * state). `version` bumps on each edit to support the last-write-wins
 * reconciliation in 0009.
 *
 * Since plan 0048 the products it stands for are a **set**, in `list_line_items`,
 * summarised here by `itemSetHash`. The single nullable `itemId` it used to carry
 * is gone; it was null on every line ever created.
 */
@Entity({ name: 'list_lines' })
// Serves both line counts, total and ready (plan 0017, section 4.3).
@Index('ix_lines_list_status', ['listId', 'status'])
export class ListLine extends BaseEntity {
  @Column({ type: 'uuid' })
  listId!: string;

  @ManyToOne(() => ShoppingList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listId' })
  list!: ShoppingList;

  @Column({ type: 'varchar' })
  content!: string;

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

  @Column({ type: 'enum', enum: LineStatus, default: LineStatus.PENDING })
  status!: LineStatus;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;
}
