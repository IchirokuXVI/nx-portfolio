import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
  type HarvestRunWarning,
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

  /**
   * The run's own input, kept so a re-run can repeat it exactly.
   *
   * For a LEAFLET_IMPORT this is **the uploaded document** (plan 0081, section
   * 7). A full leaflet is 260 to 350 KB, which Postgres stores out of line and
   * nothing reads on a hot path; plan 0082 reads it to revert, and accepting a
   * queued alias reads it to write the price the alias was waiting for.
   */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  input!: Record<string, unknown>;

  /**
   * The digest of that document, from `source.sha256`, null for every other
   * mode. A partial unique index on (`supermarketId`, this) refuses a second
   * upload of the same file for the same chain until the first run is reverted.
   */
  @Column({ type: 'varchar', nullable: true })
  documentSha256!: string | null;

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
   * Offers a rule dropped or sent to the queue (plan 0081, section 7). Backlog
   * 0001 listed this counter and plan 0038 dropped it because nothing skipped
   * anything; a leaflet import does.
   */
  @Column({ type: 'integer', default: 0 })
  skipped!: number;

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
   * Every decision the run made that was not a write, with the offer it was
   * about (plan 0081, section 7), so the run page reads as a list of them
   * rather than as counters that lost their reasons. The extractor's own
   * warnings are carried in here too, so the admin sees what the extractor
   * lost beside what the import skipped.
   */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  warnings!: HarvestRunWarning[];

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

  /**
   * When this run's writes were taken back (plan 0082).
   *
   * Plan 0081 added the column so its per document dedupe index could name it,
   * and `harvest.revert` is what fills it. Setting it does two things at once:
   * it says the run's claims were withdrawn, and it lets a corrected upload of
   * the same document past that index.
   *
   * **The status is not touched.** It says how the run ended and that did not
   * change, so a reverted run keeps its own status and carries this beside it.
   */
  @Index('ix_harvest_runs_reverted', { where: '"revertedAt" IS NOT NULL' })
  @Column({ type: 'timestamptz', nullable: true })
  revertedAt!: Date | null;

  /** The operator who reverted it. Null while the run still stands. */
  @Column({ type: 'uuid', nullable: true })
  revertedByUserId!: string | null;

  /**
   * How many `item_prices` rows the revert deleted, null until one happens.
   *
   * What catalog answered, not what the run's own counters predicted: an alias
   * accepted after the run wrote more rows on the run's behalf, and a row the
   * run only confirmed was reset rather than deleted and is not counted here.
   */
  @Column({ type: 'integer', nullable: true })
  revertedPriceCount!: number | null;
}
