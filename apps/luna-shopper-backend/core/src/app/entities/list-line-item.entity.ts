import { LineItemSource } from '@portfolio/luna-shopper/contracts';
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
 *
 * Since plan 0070 it also records **who put the product here**, in
 * {@link source}, because a line stays subscribed to the group it came from and a
 * sync that could not tell the two apart would either undo a person's edits or
 * never apply the catalog's corrections. That is still not something to audit: it
 * is a fact about the row's origin, set when it is created and moved exactly once
 * if ever, so there is still no `updatedAt` worth having.
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

  /**
   * Who put this product on the line (plan 0070, sections 2 and 3).
   *
   * **Provenance moves one way**: `GROUP` may become `USER` and never back. The
   * sync only ever touches a `GROUP` row, so adopting a product is what takes it
   * out of the subscription's reach for good, and a product somebody typed by
   * hand cannot be claimed by a group that later happens to include it.
   *
   * The default is `USER`, which is what makes plan 0070's migration correct with
   * no backfill: a product whose origin is not recorded anywhere belongs to the
   * person holding it. Guessing wrong in that direction costs a line that syncs
   * slightly less than it could; guessing wrong in the other deletes products out
   * of somebody's shopping list on the strength of a guess.
   */
  @Column({
    type: 'enum',
    enum: LineItemSource,
    default: LineItemSource.USER,
  })
  source!: LineItemSource;
}
