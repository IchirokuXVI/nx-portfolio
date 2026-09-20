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
import { GeneratedList } from './generated-list.entity';
import { ListLine } from './list-line.entity';

/**
 * What a trip asked of one zone line, written down when the trip ended (plan
 * 0135).
 *
 * A finished basket used to answer "what did you ask for" from
 * `generated_list_line_origins`, and that answer stayed true only because a
 * finished basket refuses every write, so its origins happened to stop moving.
 * Plan 0136 deletes that table and makes an open basket's ask a view of its
 * lists, which never stop moving. So the freeze becomes an act: when a basket
 * stops being `OPEN`, what it asked of every zone line is written here once, and
 * when it is reopened the rows are deleted.
 *
 * **The invariant: a basket has rows here exactly while its status is not
 * `OPEN`.** Every read of the ask leans on it, so the write is inside the
 * transaction that changes the status.
 *
 * ## What it is not
 *
 * It is not a basket line under another name. It has no text, no product, no
 * order and no state, nobody edits it, and an open basket has none. It is the
 * one number a finished trip cannot get from anywhere else.
 *
 * ## `asked` is the only fact
 *
 * What was bought is already written down, in `line_settlements` under
 * `basketId` (plan 0134), and copying it here would be a second record of one
 * purchase that a revert then has to keep in step. `left` and the outcome are
 * derived from the two, as `trips.mappers.ts` derives them today.
 *
 * Zero is a value. An origin taken back to zero is a trip that stopped asking,
 * and it is still a row of that trip, so the freeze writes it.
 *
 * ## Why `lineId` carries a foreign key where an origin's does not
 *
 * Plan 0050 left it off the origin so a basket was able to outlive a zone line
 * deleted under it. Since plan 0132 a deleted line is still a row, so the two
 * hard deletes left are a merge, which moves the row first
 * (`LineMergeService.moveTripRows`), and the cascade from a deleted list, whose
 * trips nobody can read afterwards because the read starts with `requireRead` on
 * the list. A row naming no line is unreadable today already, because
 * `basket_rows` inner joins `list_lines`, so the key removes nothing a reader
 * ever saw. It is the rule `line_settlements.lineId` already follows.
 *
 * `listId` is a copy, as it is on a settlement. A line never moves between
 * lists, so it cannot drift, and it is what the trips read and the index serve.
 * There is no `zoneId`: an origin carried one for the claim, which reads origins
 * of open baskets and never a trip row, and no read of a finished trip asks for
 * a zone.
 *
 * It does not extend `BaseEntity`, for the reason `GeneratedListLineOrigin` does
 * not: it is written once and has no life of its own to audit.
 */
@Entity({ name: 'basket_trip_rows' })
@Unique('uq_basket_trip_rows_line', ['basketId', 'lineId'])
@Index('ix_basket_trip_rows_list', ['listId', 'basketId'])
export class BasketTripRow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  basketId!: string;

  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'basketId' })
  basket!: GeneratedList;

  /** The list the line is on, copied as it is onto a settlement. */
  @Column({ type: 'uuid' })
  listId!: string;

  @Column({ type: 'uuid' })
  lineId!: string;

  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;

  /** One row per basket and zone line, however many origins fed it (plan 0094). */
  @Column({ type: 'int' })
  asked!: number;
}
