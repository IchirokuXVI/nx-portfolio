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
 * One product of a line's group that a person took off (plan 0070, section 2).
 *
 * **A user deletion has to be a record, not an absence.** Without this table a
 * person who deletes a group added product leaves no trace: the row is gone, and
 * the next sync sees a group member that is not on the line, which is exactly
 * what it sees for a product that has just joined the group. It would put the
 * deleted product back, every time, forever.
 *
 * ## A table and not a `removed` flag on `list_line_items`
 *
 * The membership table is read on every list read, and every one of those reads
 * would grow a `WHERE source <> ... AND removed = false` that is silently wrong
 * the one time somebody forgets it. A tombstone in another table cannot leak a
 * deleted product onto a screen at all.
 *
 * And `uq_list_line_item(lineId, itemId)` means "this product is on this line".
 * A tombstone is the opposite statement, so storing both in one table would make
 * that unique constraint stop meaning anything.
 *
 * These rows are read by the sync and by nothing else. `itemId` is opaque and
 * carries no foreign key into catalog, exactly as the membership row's does.
 */
@Entity({ name: 'list_line_group_removals' })
@Unique('uq_list_line_group_removal', ['lineId', 'itemId'])
@Index('ix_list_line_group_removals_line', ['lineId'])
export class ListLineGroupRemoval {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  @Column({ type: 'uuid' })
  itemId!: string;
}
