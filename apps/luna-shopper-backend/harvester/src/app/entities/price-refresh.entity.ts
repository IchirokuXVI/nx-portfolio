import { PriceRefreshStatus } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The statuses a stored row can hold. `FRESH` belongs to the view alone. */
export type StoredPriceRefreshStatus = Exclude<
  PriceRefreshStatus,
  PriceRefreshStatus.FRESH
>;

/**
 * One fetch of one product of one chain at one fetch scope, that a shopper
 * asked for (harvester plan 0216, section 4).
 *
 * **It is not a run**, and that is the central choice of the plan. A run row
 * would take `uq_harvest_run_active`, so a refresh would be refused for the
 * whole of a walk and would make a schedule slot `SKIPPED_BUSY` while it ran.
 *
 * A refusal before a fetch writes no row. A row exists to answer the poll and
 * to let a person see who fetched what and when. Rows older than 90 days are
 * deleted by the refresh service's timer.
 *
 * It does not extend `BaseEntity`: the plan's table states `requestedAt` and
 * `finishedAt` and no other clock, and a row is written twice in its life.
 *
 * Every id here is opaque, as on every harvester table: no foreign key points
 * at another service, and `sourceId` and `entryId` have none either, so a
 * deleted source row does not take the record of its refreshes with it.
 */
@Entity({ name: 'price_refreshes' })
@Index('ix_price_refreshes_requested_by', ['requestedByUserId', 'requestedAt'])
@Index('ix_price_refreshes_supermarket', ['supermarketId', 'requestedAt'])
// What the join of section 7.1, step 7, reads: the refresh in flight for one
// product at one fetch scope.
@Index('ix_price_refreshes_pending', ['entryId', 'fetchScopeId'], {
  where: `"status" = 'PENDING'`,
})
export class PriceRefresh {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The shopper. */
  @Column({ type: 'uuid' })
  requestedByUserId!: string;

  @Column({ type: 'uuid' })
  supermarketId!: string;

  /** The `supermarket_sources` row. */
  @Column({ type: 'uuid' })
  sourceId!: string;

  /** The `source_catalog_entries` row that was fetched. */
  @Column({ type: 'uuid' })
  entryId!: string;

  @Column({ type: 'uuid' })
  itemId!: string;

  /** The scope the shopper asked about. */
  @Column({ type: 'uuid' })
  priceScopeId!: string;

  /** The scope the price was read at (section 3, step 2). */
  @Column({ type: 'uuid' })
  fetchScopeId!: string;

  // The stored values only, in the migration's order. FRESH is a status of the
  // view and never stored, so a schema diff or a baseline read from the
  // entities must not add it to the database type.
  @Column({
    type: 'enum',
    enum: [
      PriceRefreshStatus.PENDING,
      PriceRefreshStatus.DONE,
      PriceRefreshStatus.NOT_STOCKED,
      PriceRefreshStatus.FAILED,
      PriceRefreshStatus.BLOCKED,
    ] satisfies StoredPriceRefreshStatus[],
    enumName: 'price_refresh_status',
  })
  status!: StoredPriceRefreshStatus;

  /** Rows catalog inserted, copies excluded. */
  @Column({ type: 'integer', default: 0 })
  pricesWritten!: number;

  /** Values catalog already held, copies excluded. */
  @Column({ type: 'integer', default: 0 })
  pricesConfirmed!: number;

  /** Null unless `FAILED` or `BLOCKED`. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  requestedAt!: Date;

  /** Null while `PENDING`. */
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
