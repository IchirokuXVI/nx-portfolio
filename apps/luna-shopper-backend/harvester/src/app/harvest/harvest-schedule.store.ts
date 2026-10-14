import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { HarvestScheduleOutcome } from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { HarvestSchedule } from '../entities';
import { nextSlot, previousSlot } from './schedule-slot';

/** A slot the worker claimed, and the row as the claim left it. */
export interface ClaimedSlot {
  schedule: HarvestSchedule;
  /** The last slot of the rule at or before the instant of the claim. */
  slot: Date;
}

/** What one decision about a slot writes on the row (plan 0206, section 5.3). */
export interface ScheduleOutcomeWrite {
  outcome: HarvestScheduleOutcome;
  note: string | null;
  at: Date;
  /** The run that started, or null when none did. */
  runId: string | null;
  /**
   * What `lastSlotAttempts` becomes, or null to leave it. A slot writes 1 when
   * its run starts and leaves the 0 its claim wrote otherwise. A retry leaves
   * the 2 its own claim wrote, started or not.
   */
  attempts: number | null;
}

/**
 * Every read and write of a `harvest_schedules` row, in one place, like
 * {@link HarvestRunPresetStore} for presets.
 *
 * **The worker's writes are raw SQL and leave `updatedAt` alone.** That column
 * and `updatedByUserId` say when a person last changed the schedule. A claim
 * every week is not an edit, and a write through the repository would stamp it
 * as one.
 */
@Injectable()
export class HarvestScheduleStore {
  constructor(
    @InjectRepository(HarvestSchedule)
    private readonly schedules: Repository<HarvestSchedule>
  ) {}

  async load(scheduleId: string): Promise<HarvestSchedule> {
    const row = await this.schedules.findOne({ where: { id: scheduleId } });
    if (!row) {
      throw new NotFoundException('Harvest schedule not found');
    }
    return row;
  }

  async save(row: HarvestSchedule): Promise<HarvestSchedule> {
    return this.schedules.save(row);
  }

  create(input: Partial<HarvestSchedule>): HarvestSchedule {
    return this.schedules.create(input);
  }

  async delete(scheduleId: string): Promise<void> {
    const result = await this.schedules.delete({ id: scheduleId });
    if (!result.affected) {
      throw new NotFoundException('Harvest schedule not found');
    }
  }

  /** The schedules that name a preset, for the refusal to delete it. */
  async findByPreset(presetId: string): Promise<HarvestSchedule[]> {
    return this.schedules.find({
      where: { presetId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Claim the oldest due slot, or answer null (plan 0206, section 5.1).
   *
   * **One transaction that locks the row** with `FOR UPDATE SKIP LOCKED`, the
   * shape `PostalCodeDiscoveryStore.claimNext` uses: a second harvester that
   * finds this row taken looks for another one rather than waiting behind it,
   * and once this commits the row is no longer due for it at all.
   *
   * The claim spends the slot before any run starts. `nextRunAt` moves to the
   * first slot after `now`, and `lastSlotAt` becomes the last slot at or before
   * `now` (review point 1), so several missed slots are one decision about the
   * newest. `lastSlotAttempts` goes to 0 (review point 2): only a run that
   * starts raises it, so a slot that started nothing can never be retried as
   * if it had. A crash between this and the start thus loses one slot and never
   * fires one two times.
   *
   * `now` is a parameter and not the database's `now()`, so the slot, the next
   * slot and the due test all read one clock, and a test can pass its own.
   */
  async claimDue(now: Date): Promise<ClaimedSlot | null> {
    return this.schedules.manager.transaction(async (manager) => {
      const rows: HarvestSchedule[] = await manager.query(
        `SELECT *
           FROM "harvest_schedules"
          WHERE "enabled"
            AND "nextRunAt" <= $1
          ORDER BY "nextRunAt" ASC, "id" ASC
          LIMIT 1
            FOR UPDATE SKIP LOCKED`,
        [now]
      );
      const row = rows[0];
      if (!row) {
        return null;
      }
      const slot = previousSlot(row, now);
      const next = nextSlot(row, now);
      await manager.query(
        `UPDATE "harvest_schedules"
            SET "nextRunAt" = $2,
                "lastSlotAt" = $3,
                "lastSlotAttempts" = 0
          WHERE "id" = $1`,
        [row.id, next, slot]
      );
      return {
        schedule: {
          ...row,
          nextRunAt: next,
          lastSlotAt: slot,
          lastSlotAttempts: 0,
        },
        slot,
      };
    });
  }

  /** Write what became of a slot, or of its retry. */
  async recordOutcome(
    scheduleId: string,
    write: ScheduleOutcomeWrite
  ): Promise<void> {
    await this.schedules.query(
      `UPDATE "harvest_schedules"
          SET "lastOutcome" = $2,
              "lastOutcomeAt" = $3,
              "lastOutcomeNote" = $4,
              "lastRunId" = COALESCE($5, "lastRunId"),
              "lastSlotAttempts" = COALESCE($6, "lastSlotAttempts")
        WHERE "id" = $1`,
      [
        scheduleId,
        write.outcome,
        write.at,
        write.note,
        write.runId,
        write.attempts,
      ]
    );
  }

  /**
   * The schedules whose run for the current slot was interrupted (plan 0206,
   * section 7): the run ended `ABORTED` with no person's abort behind it, or
   * the reaper marked it `STALE`.
   *
   * Only `lastSlotAttempts = 1` qualifies, which a slot reaches when its run
   * started and nothing else reaches. The run must also name this schedule,
   * so a `lastRunId` can never point a retry at a run of another schedule.
   * Whether the slot is still young enough is the caller's test, because it
   * needs the rule.
   */
  async findInterrupted(): Promise<HarvestSchedule[]> {
    return this.schedules.query(
      `SELECT s.*
         FROM "harvest_schedules" AS s
         JOIN "harvest_runs" AS r ON r."id" = s."lastRunId"
        WHERE s."enabled"
          AND s."lastSlotAttempts" = 1
          AND s."lastSlotAt" IS NOT NULL
          AND r."scheduleId" = s."id"
          AND (
                (r."status" = 'ABORTED' AND r."abortRequestedAt" IS NULL)
             OR r."status" = 'STALE'
          )
        ORDER BY s."lastSlotAt" ASC, s."id" ASC`
    );
  }

  /**
   * Claim the one retry of a slot before it starts (review point 3).
   *
   * A conditional update rather than a read and a write, so two processes
   * cannot both pass the test. The retry is spent here whether the start then
   * works or not (the owner's decision on review point 4), so a retry that is
   * refused is not tried again on each tick, and a crash after this costs the
   * retry and never makes two.
   */
  async claimRetry(scheduleId: string, runId: string): Promise<boolean> {
    // An UPDATE answers `[rows, rowCount]` through TypeORM's postgres driver.
    // See `PostalCodeDiscoveryStore.claimNext`.
    const [rows]: [{ id: string }[], number] = await this.schedules.query(
      `UPDATE "harvest_schedules"
          SET "lastSlotAttempts" = 2
        WHERE "id" = $1
          AND "enabled"
          AND "lastSlotAttempts" = 1
          AND "lastRunId" = $2
       RETURNING "id"`,
      [scheduleId, runId]
    );
    return rows.length > 0;
  }

  repository(): Repository<HarvestSchedule> {
    return this.schedules;
  }
}
