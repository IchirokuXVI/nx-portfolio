import {
  HarvestAlertKind,
  HarvestAlertStatus,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One alert to the owner, kept as an outbox row (plan 0218, section 4).
 *
 * **It is written in the transaction of the outcome it reports**: the run's
 * final status, the slot's outcome, or the postal code's last failure. No
 * alert exists for an outcome that did not commit, and a restart loses none,
 * because the worker that sends it reads this table and nothing in memory.
 *
 * `dedupeKey` is unique and every insert is `ON CONFLICT DO NOTHING`, so one
 * outcome is one row however many times it is decided.
 *
 * `supermarketId`, `runId` and `scheduleId` have **no foreign key**, for the
 * reason `harvest_runs.presetId` has none: the tables of the harvester do not
 * cascade.
 */
@Entity({ name: 'harvest_alerts' })
@Index('ix_harvest_alerts_due', ['status', 'nextAttemptAt'])
export class HarvestAlert extends BaseEntity {
  @Column({
    type: 'enum',
    enum: HarvestAlertKind,
    enumName: 'harvest_alert_kind',
  })
  kind!: HarvestAlertKind;

  @Index('uq_harvest_alerts_dedupe_key', { unique: true })
  @Column({ type: 'varchar', length: 200 })
  dedupeKey!: string;

  @Column({
    type: 'enum',
    enum: HarvestAlertStatus,
    enumName: 'harvest_alert_status',
    default: HarvestAlertStatus.PENDING,
  })
  status!: HarvestAlertStatus;

  @Column({ type: 'uuid', nullable: true })
  supermarketId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  runId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  scheduleId!: string | null;

  /** Every fact the message needs, so the worker reads no other table. */
  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  /** When a worker took the row. A `SENDING` row older than 10 minutes is taken again. */
  @Column({ type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  /** The transport's last answer. */
  @Column({ type: 'text', nullable: true })
  lastError!: string | null;
}
