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
import { GeneratedListLine } from './generated-list-line.entity';

/**
 * One zone line that fed a basket line (plan 0050, section 1): the provenance
 * row, and the thing that makes settling back to the right lists possible at all.
 *
 * It does not extend `BaseEntity`, on the same reasoning as `ListLineItem`: a
 * provenance row has no life of its own to audit. It is written once at
 * generation, it is read when a settle allocates units across the origins (plan
 * 0051, section 6.2), and it is never edited.
 *
 * `zoneId`, `listId` and `lineId` are core's own ids and none of them carries a
 * foreign key. A zone line can be deleted underneath a basket, and a basket that
 * outlived its origin is an ordinary thing to have in a history: the settle
 * reports the origin as skipped rather than the delete being blocked by a
 * shopping list somebody made in March.
 *
 * `quantity` is what this origin contributed to the line's summed quantity, and
 * `lineVersion` is what the origin's `version` was at the time. Plan 0050 needed
 * that version to reconcile a status write back; plan 0047 made settling an
 * append, so what it is for now is telling a reader that the origin has moved,
 * which is information rather than a conflict to resolve.
 */
@Entity({ name: 'generated_list_line_origins' })
@Unique('uq_generated_list_line_origin', ['generatedListLineId', 'lineId'])
@Index('ix_generated_list_line_origins_line', ['generatedListLineId'])
export class GeneratedListLineOrigin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  generatedListLineId!: string;

  @ManyToOne(() => GeneratedListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'generatedListLineId' })
  generatedListLine!: GeneratedListLine;

  @Column({ type: 'uuid' })
  zoneId!: string;

  @Column({ type: 'uuid' })
  listId!: string;

  /**
   * The zone line this came from.
   *
   * Indexed on its own because the overlap check in section 3 asks the reverse
   * question on every run: is this line already carried by an `ACTIVE` basket of
   * the same user.
   */
  @Index('ix_generated_list_line_origins_source')
  @Column({ type: 'uuid' })
  lineId!: string;

  /** What this origin contributed to the basket line's summed quantity. */
  @Column({ type: 'int', default: 1 })
  quantity!: number;

  /** The origin's `version` at generation time. */
  @Column({ type: 'int', default: 1 })
  lineVersion!: number;
}
