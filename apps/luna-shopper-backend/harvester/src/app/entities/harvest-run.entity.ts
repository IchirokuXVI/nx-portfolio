import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One run and its progress (plan 0038, section 4.2).
 *
 * `supermarketId` is **nullable**, and that is a design statement rather than a
 * convenience: a store discovery run belongs to a postal code and a radius, not
 * to a chain. It discovers many chains at once, and several of them will not
 * exist as `Supermarket` rows until it finishes.
 *
 * The counters, `stage`, `stageLabel` and `heartbeatAt` are written every batch
 * and at least every 10 seconds. That is what survives a page reload, and it
 * rides along with a write that is already happening. Live progress is **polling
 * `harvest.run.get`** (section 6.6); the realtime `admin:harvest` room stays
 * deferred, and there is deliberately no second push path in the gateway.
 *
 * One active run per supermarket is enforced by a partial unique index the
 * migration creates rather than by application code, so it holds across restarts
 * and between two callers racing.
 */
@Entity({ name: 'harvest_runs' })
export class HarvestRun extends BaseEntity {
  /** Null for a store discovery run. See the class doc. */
  @Index('ix_harvest_runs_supermarket')
  @Column({ type: 'uuid', nullable: true })
  supermarketId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  /** Opaque: the catalog scope a CATALOG_DISCOVERY or REFRESH writes prices for. */
  @Column({ type: 'uuid', nullable: true })
  priceScopeId!: string | null;

  @Column({ type: 'enum', enum: HarvestRunMode })
  mode!: HarvestRunMode;

  @Column({
    type: 'enum',
    enum: HarvestRunTrigger,
    default: HarvestRunTrigger.MANUAL,
  })
  trigger!: HarvestRunTrigger;

  @Index('ix_harvest_runs_status')
  @Column({
    type: 'enum',
    enum: HarvestRunStatus,
    default: HarvestRunStatus.PENDING,
  })
  status!: HarvestRunStatus;

  /** The run's own input, kept so a re-run can repeat it exactly. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  input!: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  requestedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  /** What the stale reaper reads. Older than HARVEST_STALE_AFTER means gone. */
  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt!: Date | null;

  /** Null until the run knows how much work it has, i.e. after the tree walk. */
  @Column({ type: 'integer', nullable: true })
  totalPlanned!: number | null;

  @Column({ type: 'integer', default: 0 })
  processed!: number;

  @Column({ type: 'integer', default: 0 })
  created!: number;

  @Column({ type: 'integer', default: 0 })
  updated!: number;

  @Column({ type: 'integer', default: 0 })
  unchanged!: number;

  /** A 404 from a detail call: "not stocked here" is a value, not a failure. */
  @Column({ type: 'integer', default: 0 })
  notFound!: number;

  /**
   * A failing work item does not fail the run: it is counted here and logged
   * with its external id and URL, and the worker takes the next item. A run fails
   * only when the source is unusable or this crosses a configured fraction of
   * `totalPlanned`.
   */
  @Column({ type: 'integer', default: 0 })
  failed!: number;

  @Column({ type: 'varchar', nullable: true })
  stage!: string | null;

  @Column({ type: 'varchar', nullable: true })
  stageLabel!: string | null;

  /**
   * Set by `harvest.abort`. The run cancels the in flight request through its
   * `AbortSignal`, stops fetching, **flushes what it has**, and finalizes as
   * ABORTED: everything observed before the abort is kept, because prices already
   * fetched are valid data.
   */
  @Column({ type: 'timestamptz', nullable: true })
  abortRequestedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /**
   * What the run has to say about itself beyond its counters (plan 0085,
   * section 3). Empty when it has nothing.
   *
   * It is not an error and it does not fail a run. A DEZA query returns at most
   * 300 rows however it is filtered, so a run splits a capped section by search
   * term until a pass adds nothing new or a budget runs out, and what it could
   * not finish has to be **stated** rather than left to look like a whole
   * catalog. The same bag carries the availability rows a person had typed,
   * which plan 0084 section 3 declines to overwrite and requires the run to
   * report instead.
   *
   * Free form and never queried, which is why it is one jsonb column rather than
   * a table: nothing decides on it, and a person reads it once.
   */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  report!: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  correlationId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByUserId!: string | null;
}
