import {
  HarvestRunTrigger,
  SourceProbeStatus,
  type AdapterKey,
  type SourceProbeStepView,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One probe of one chain's storefront (plan 0219, section 4).
 *
 * **A row of its own, not a run.** A run holds the chain's lock, counts in
 * `consecutiveFailures` and carries a sink, counters and a report, and none of
 * that fits two to five requests a day. A probe writes this table and nothing
 * else.
 *
 * `sourceId` has **no foreign key**, as `harvest_runs.sourceId` has none:
 * deleting a source row leaves its probes. The partial unique index on a
 * `RUNNING` probe per source is the backstop for a manual start racing the
 * worker.
 */
@Entity({ name: 'source_probes' })
@Index('ix_source_probes_source_started', ['sourceId', 'startedAt'])
export class SourceProbe extends BaseEntity {
  @Column({ type: 'uuid' })
  sourceId!: string;

  @Column({ type: 'uuid' })
  supermarketId!: string;

  @Column({ type: 'varchar' })
  adapterKey!: AdapterKey;

  /** `MANUAL` or `SCHEDULED`, never `SYSTEM`. */
  @Column({
    type: 'enum',
    enum: HarvestRunTrigger,
    enumName: 'harvest_run_trigger',
  })
  trigger!: HarvestRunTrigger;

  @Column({
    type: 'enum',
    enum: SourceProbeStatus,
    enumName: 'source_probe_status',
    default: SourceProbeStatus.RUNNING,
  })
  status!: SourceProbeStatus;

  /**
   * The status of the newest finished probe of the same source that is not
   * `ABORTED`, read when this one finished. Null for the first.
   */
  @Column({
    type: 'enum',
    enum: SourceProbeStatus,
    enumName: 'source_probe_status',
    nullable: true,
  })
  previousStatus!: SourceProbeStatus | null;

  /**
   * True when `status` differs from `previousStatus` and that is not null.
   * The whole interface a later alert reads (section 10).
   */
  @Column({ type: 'boolean', default: false })
  changed!: boolean;

  /**
   * The attempt of one `UNREACHABLE` series, 1 to 3. A manual probe and one
   * the interval made due are 1; a retry after an `UNREACHABLE` is the one
   * after it (the owner's decision of 2026-11-06).
   */
  @Column({ type: 'smallint', default: 1 })
  attempt!: number;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  requests!: number;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  steps!: SourceProbeStepView[];

  /** One sentence naming the step and its first problem. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByUserId!: string | null;

  /**
   * The schedule whose slot ran this probe as its gate, null for a daily or
   * a manual probe (plan 0247, the owner on 2026-11-06). No foreign key, so a
   * deleted schedule keeps its probes.
   */
  @Column({ type: 'uuid', nullable: true })
  scheduleId!: string | null;
}
