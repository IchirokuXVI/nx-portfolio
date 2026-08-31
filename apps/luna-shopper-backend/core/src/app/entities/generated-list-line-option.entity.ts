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
 * One product a basket line's pick may be switched between (plan 0050, section
 * 1).
 *
 * The union of the origin lines' product sets (plan 0048, section 1.1), copied at
 * generation time under the same snapshot posture as everything else here: the
 * zone line's set can change afterwards and this one does not move with it.
 *
 * A free text origin contributes no options, and such a line's `itemId` stays
 * null. That is the shape the whole pick idea rests on, and it is why the options
 * are a table rather than a computed union at read time: the set is a property of
 * the run, not of the lists as they stand today.
 *
 * Like the provenance rows beside it, this does not extend `BaseEntity` and holds
 * no foreign key into catalog. `itemId` is opaque across a service boundary,
 * exactly as `ListLineItem.itemId` is.
 */
@Entity({ name: 'generated_list_line_options' })
@Unique('uq_generated_list_line_option', ['generatedListLineId', 'itemId'])
@Index('ix_generated_list_line_options_line', ['generatedListLineId', 'position'])
export class GeneratedListLineOption {
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
  itemId!: string;

  /**
   * Where this product sits in the option list, in the order it was attached.
   *
   * Explicit rather than derived from `createdAt`, for the reason `ListLineItem`
   * gives: a set written in one statement shares a timestamp to the microsecond
   * and would come back in whatever order the planner felt like.
   */
  @Column({ type: 'int', default: 0 })
  position!: number;
}
