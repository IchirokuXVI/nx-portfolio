import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ListLine } from './list-line.entity';

/**
 * One product of a line's product set (plan 0048, section 1.1).
 *
 * It does not extend `BaseEntity`, and that is deliberate: a membership row has
 * no life of its own to audit. It is created, it is deleted, and it is never
 * edited, so an `updatedAt` on it would be a column that never changes.
 *
 * `itemId` is an opaque reference into the catalog service's database, checked
 * for shape in application code and never a foreign key, exactly as the single
 * `list_lines."itemId"` this replaced was.
 */
@Entity({ name: 'list_line_items' })
@Unique('uq_list_line_item', ['lineId', 'itemId'])
@Index('ix_list_line_items_line', ['lineId', 'position'])
export class ListLineItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  @Index('ix_list_line_items_item')
  @Column({ type: 'uuid' })
  itemId!: string;

  /**
   * Where this product sits in the set, in the order it was attached.
   *
   * Explicit rather than derived from `createdAt`, because a set written in one
   * statement shares a timestamp to the microsecond and would come back in
   * whatever order the planner felt like.
   */
  @Column({ type: 'int', default: 0 })
  position!: number;
}
