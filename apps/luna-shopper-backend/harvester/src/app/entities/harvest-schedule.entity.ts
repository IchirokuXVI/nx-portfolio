import { HarvestScheduleOutcome } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A preset that starts by itself (plan 0206, section 2): a time of day, the
 * days of the week, and a timezone.
 *
 * **Nothing about a schedule lives in the memory of the process.** The worker
 * polls `nextRunAt`, so a restart loses no schedule, and a second harvester on
 * the same database cannot fire the slot the first one claimed.
 *
 * A preset can have more than one schedule, because one row holds one time of
 * day. The schedule is on its own table and not on `supermarket_sources`, which
 * plan 0038 kept free of schedule columns: a chain can want a weekly walk and a
 * monthly store list from two presets.
 *
 * `presetId` and `lastRunId` have **no foreign key**, for the reason
 * `harvest_runs.presetId` has none: the tables of the harvester do not cascade.
 * A preset with a schedule refuses to be deleted instead.
 */
@Entity({ name: 'harvest_schedules' })
export class HarvestSchedule extends BaseEntity {
  @Index('ix_harvest_schedules_preset')
  @Column({ type: 'uuid' })
  presetId!: string;

  /** Copied from the preset when the schedule is created. */
  @Index('ix_harvest_schedules_supermarket')
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /** `HH:mm`, 24 hour, checked by a constraint. */
  @Column({ type: 'varchar', length: 5 })
  timeOfDay!: string;

  /** ISO numbers, 1 is Monday and 7 is Sunday, at least one. */
  @Column({ type: 'smallint', array: true })
  daysOfWeek!: number[];

  /** An IANA name. */
  @Column({ type: 'varchar', length: 64, default: 'Europe/Madrid' })
  timezone!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /**
   * The slot the worker claims next. Null while the schedule is off, which a
   * constraint holds. The index the worker reads is partial on `enabled`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  nextRunAt!: Date | null;

  /** The slot the last claim was for, kept as history when it is switched off. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSlotAt!: Date | null;

  /**
   * The runs started for `lastSlotAt`: 0 when the slot started none, 1 after
   * its run started, and 2 once the one retry of section 7 was claimed, whether
   * that retry started a run or not.
   */
  @Column({ type: 'smallint', default: 0 })
  lastSlotAttempts!: number;

  /** The last run this schedule started. */
  @Column({ type: 'uuid', nullable: true })
  lastRunId!: string | null;

  @Column({
    type: 'enum',
    enum: HarvestScheduleOutcome,
    enumName: 'harvest_schedule_outcome',
    nullable: true,
  })
  lastOutcome!: HarvestScheduleOutcome | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastOutcomeAt!: Date | null;

  /** The refusal, or the run that was in the way. */
  @Column({ type: 'text', nullable: true })
  lastOutcomeNote!: string | null;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'uuid' })
  updatedByUserId!: string;
}
