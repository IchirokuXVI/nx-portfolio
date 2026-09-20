import {
  LineApprovalStatus,
  LineChangeKind,
} from '@portfolio/luna-shopper/contracts';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ShoppingList } from './shopping-list.entity';

/**
 * One change to what a list asks for (plan 0138, section 2).
 *
 * Nothing in core remembered a change before this table. `list_lines.version`
 * said that a line moved and not how, a delete left nothing to read, and a merge
 * told the list room that one line went and another changed, which a basket read
 * as a removal beside a change. This is the record those three needed, and it is
 * what a basket's marks and its change log are both computed from.
 *
 * ## It is keyed by the list, never by a basket
 *
 * A basket follows its lists (plan 0136), so one write to a list is a change in
 * every basket that covers it. Keying the record by list means one row serves all
 * of them, and it is why {@link basketId} below is attribution rather than a
 * scope: it says where the write came **from**, not who it is **for**.
 *
 * ## One row per line per write
 *
 * A write that moves several things is one row, and {@link kind} names the most
 * significant of them in the order `MERGED`, `DELETED`, `RENAMED`,
 * `QUANTITY_CHANGED`, `APPROVAL_CHANGED`. The three column pairs carry
 * everything that moved and a pair is null when that thing did not, so an edit
 * that renames a line, sets its quantity and sends it back to `PENDING` is one
 * `RENAMED` row with all six filled.
 *
 * ## Why it is not `core_audit` (plan 0077)
 *
 * They answer different people. The audit trail is written by an operator's edit
 * alone, holds the whole row before as a document, lives for ever and is read by
 * the back office. This is written by every change of demand by anybody, holds
 * three typed pairs because a screen draws them, is swept after thirty days and
 * is read by a shopper, a guest included. An operator's edit writes both.
 *
 * It does not extend `BaseEntity`, for {@link LineSettlement}'s reason: a change
 * is written once and never edited, so an `updatedAt` here would be a column that
 * can never move.
 */
@Entity({ name: 'list_line_changes' })
/** Every read is "the changes of these lists since a moment", in this order. */
@Index('ix_list_line_changes_list', ['listId', 'createdAt', 'id'])
/** The retention sweep, which walks the oldest rows of the whole table. */
@Index('ix_list_line_changes_created', ['createdAt'])
export class ListLineChange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The transaction's start, written by the database and never by an application
   * server (`DEFAULT now()`, and the insert leaves the column out).
   *
   * Every row one act writes therefore shares one value, which is what the
   * acknowledgement relies on: acknowledging one row of a basket rename over
   * three lists acknowledges all three.
   */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  /**
   * A copy, as it is on a provenance row, so the list ref of a change can be
   * redacted without a join.
   */
  @Column({ type: 'uuid' })
  zoneId!: string;

  /**
   * The list, which **cascades**: a list that is deleted leaves every coverage,
   * so nothing can read its changes again.
   */
  @Column({ type: 'uuid' })
  listId!: string;

  @ManyToOne(() => ShoppingList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listId' })
  list!: ShoppingList;

  /**
   * The line it happened to, with **no foreign key**.
   *
   * A merge removes the absorbed row for real (plan 0112), and the change that
   * says so has to outlive it. {@link mergedIntoLineId} has none for the same
   * reason: a survivor can be absorbed by a later merge.
   */
  @Column({ type: 'uuid' })
  lineId!: string;

  /**
   * **A `varchar` with a check constraint, not a Postgres enum.**
   *
   * `core/src/migrate.ts` commits every pending migration in one transaction,
   * where a newly created enum value cannot be used, so a migration that added a
   * kind and wrote it would fail. `generated_list_participants.endedReason` set
   * this precedent.
   */
  @Column({ type: 'varchar' })
  kind!: LineChangeKind;

  @Column({ type: 'varchar', nullable: true })
  contentBefore!: string | null;

  @Column({ type: 'varchar', nullable: true })
  contentAfter!: string | null;

  @Column({ type: 'int', nullable: true })
  quantityBefore!: number | null;

  @Column({ type: 'int', nullable: true })
  quantityAfter!: number | null;

  @Column({ type: 'varchar', nullable: true })
  approvalBefore!: LineApprovalStatus | null;

  @Column({ type: 'varchar', nullable: true })
  approvalAfter!: LineApprovalStatus | null;

  /** The surviving line, set exactly when {@link kind} is `MERGED`. */
  @Column({ type: 'uuid', nullable: true })
  mergedIntoLineId!: string | null;

  /**
   * The account behind the change, the operator included, and null for a guest.
   *
   * It is the **actor's** own account rather than the one the write was
   * authorized against. Those differ on a delegated write: changing what a
   * household asks for from a basket is checked against the basket's owner (plan
   * 0131) while the person doing it may be a guest.
   */
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /** The participant, when the write came through a basket (plan 0136). */
  @Column({ type: 'uuid', nullable: true })
  actorParticipantId!: string | null;

  /**
   * The basket the write came through, set whenever
   * {@link actorParticipantId} is (`ck_list_line_changes_basket_actor`).
   *
   * None of the three carries a foreign key: a change is a fact about a list, and
   * it outlives the basket it was made from and the account that made it.
   */
  @Column({ type: 'uuid', nullable: true })
  basketId!: string | null;
}
