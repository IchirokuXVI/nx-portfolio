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
 * state). `itemId` is a nullable, opaque reference to the future catalog (plan
 * 0012); a line never requires an item. `version` bumps on each edit to support
 * the last-write-wins reconciliation in 0009.
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

  @Column({ type: 'uuid', nullable: true })
  itemId!: string | null;

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
