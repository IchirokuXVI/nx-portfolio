import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { HarvestScheduleOutcome } from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import { Repository, type QueryRunner } from 'typeorm';
import { HarvestSchedule } from '../entities';
import type { HarvestAlertDraft } from './alerts/harvest-alert.rules';
import { insertAlert } from './alerts/harvest-alert.store';
import { nextSlot, previousSlot } from './schedule-slot';

/**
 * A claimed slot with no decision, over `s` (see `findUndecided`). The same
 * text in the read and in the conditional claim, so the two cannot disagree.
 */
const NO_OUTCOME = `s."lastSlotAttempts" = 0
          AND s."lastSlotAt" IS NOT NULL
          AND (s."lastOutcomeAt" IS NULL OR s."lastOutcomeAt" < s."lastSlotAt")`;
const UNDECIDED = `s."enabled"
          AND ${NO_OUTCOME}
          AND NOT EXISTS (
                SELECT 1 FROM "harvest_runs" AS r
                 WHERE r."scheduleId" = s."id"
                   AND r."requestedAt" >= s."lastSlotAt"
              )`;

/**
 * The first key of the advisory lock that holds a schedule while its slot is
 * decided, the plan's number, so it cannot meet a lock of other code.
 */
const SLOT_LOCK_CLASS = 247;

/** A schedule held by {@link HarvestScheduleStore.holdSlot}. */
export interface SlotHold {
  release(): Promise<void>;
}

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

  /**
   * Write what became of a slot, or of its retry.
   *
   * `alert` is the slot's alert to the owner (plan 0218, section 4.1). With
   * one, the outcome and the alert row are written in one transaction, so no
   * alert exists for an outcome that did not commit.
   */
  async recordOutcome(
    scheduleId: string,
    write: ScheduleOutcomeWrite,
    alert?: HarvestAlertDraft
  ): Promise<void> {
    const sql = `UPDATE "harvest_schedules"
          SET "lastOutcome" = $2,
              "lastOutcomeAt" = $3,
              "lastOutcomeNote" = $4,
              "lastRunId" = COALESCE($5, "lastRunId"),
              "lastSlotAttempts" = COALESCE($6, "lastSlotAttempts")
        WHERE "id" = $1`;
    const parameters = [
      scheduleId,
      write.outcome,
      write.at,
      write.note,
      write.runId,
      write.attempts,
    ];
    if (!alert) {
      await this.schedules.query(sql, parameters);
      return;
    }
    await this.schedules.manager.transaction(async (manager) => {
      await manager.query(sql, parameters);
      await insertAlert(manager, alert);
    });
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

  /**
   * The schedules whose current slot was claimed and never decided: a
   * shutdown came while the probe gate of plan 0247 ran or waited for a
   * probe, so the worker wrote no outcome (an abort is not a failure of the
   * chain).
   *
   * The claim writes `lastSlotAt` and sets `lastSlotAttempts` to 0, and every
   * decision writes `lastOutcomeAt` at or after the claim, which is at or
   * after the slot. A decision of an earlier slot is older than this slot. So
   * attempts 0 and no outcome at or after `lastSlotAt` is a claim with no
   * decision, and nothing else. A row whose run of this schedule was requested
   * at or after the slot is left out: its slot started, whatever its outcome
   * write did.
   */
  async findUndecided(): Promise<HarvestSchedule[]> {
    return this.schedules.query(
      `SELECT s.*
         FROM "harvest_schedules" AS s
        WHERE ${UNDECIDED}
        ORDER BY s."lastSlotAt" ASC, s."id" ASC`
    );
  }

  /**
   * Claim the one retry of an undecided slot before it runs, as
   * {@link claimRetry} does for a stopped run: attempts go to 2, so the retry
   * is spent whether it then decides the slot or is interrupted again, and a
   * second process or a second restart cannot retry it a second time.
   */
  async claimUndecided(scheduleId: string, slot: Date): Promise<boolean> {
    const [rows]: [{ id: string }[], number] = await this.schedules.query(
      `UPDATE "harvest_schedules" AS s
          SET "lastSlotAttempts" = 2
        WHERE s."id" = $1
          AND s."lastSlotAt" = $2
          AND ${UNDECIDED}
       RETURNING s."id"`,
      [scheduleId, slot]
    );
    return rows.length > 0;
  }

  /**
   * Whether the slot still has no outcome and no retry, for a worker that has
   * just taken the hold of its own claim: a retry of another process may have
   * decided it in between. A retry writes its outcome or its attempts before
   * it lets the hold go, so this needs no read of the runs.
   */
  async isUndecided(scheduleId: string, slot: Date): Promise<boolean> {
    const rows: { id: string }[] = await this.schedules.query(
      `SELECT s."id"
         FROM "harvest_schedules" AS s
        WHERE s."id" = $1
          AND s."lastSlotAt" = $2
          AND ${NO_OUTCOME}`,
      [scheduleId, slot]
    );
    return rows.length > 0;
  }

  /**
   * Hold a schedule while its slot is decided, or answer null when another
   * connection holds it.
   *
   * **The row cannot say that a live process is still deciding a slot**, only
   * that no outcome was written, and a gate can take minutes. A session
   * advisory lock on a connection of its own can: it lasts while the decision
   * runs, and Postgres frees it the moment that process or its connection
   * dies. So the retry of an undecided slot never takes a slot that a live
   * worker is still deciding (plan 0247, review round 1). No schema change.
   */
  async holdSlot(scheduleId: string): Promise<SlotHold | null> {
    const runner = this.schedules.manager.connection.createQueryRunner();
    await runner.connect();
    try {
      const [row]: { held: boolean }[] = await runner.query(
        `SELECT pg_try_advisory_lock(${SLOT_LOCK_CLASS}, hashtext($1)) AS "held"`,
        [scheduleId]
      );
      if (!row?.held) {
        await runner.release();
        return null;
      }
    } catch (error) {
      // The lock may have been taken before the answer was lost.
      await discardRunner(runner, error);
      throw error;
    }
    return {
      release: async () => {
        try {
          await runner.query(
            `SELECT pg_advisory_unlock(${SLOT_LOCK_CLASS}, hashtext($1))`,
            [scheduleId]
          );
        } catch (error) {
          // The session may still hold the lock. Back in the pool, the
          // connection would keep it for whoever borrows it next, and every
          // other process would read the slot as in progress until that
          // connection closes. Destroyed, it frees the lock with it.
          await discardRunner(runner, error);
          throw error;
        }
        await runner.release();
      },
    };
  }

  repository(): Repository<HarvestSchedule> {
    return this.schedules;
  }
}

/**
 * Give up a runner's connection without returning it to the pool. A pg-pool
 * client released with an error is removed and closed, and Postgres frees
 * every session lock of a connection that closes. TypeORM's postgres runner
 * passes that error on through `releasePostgresConnection`, which `release`
 * calls with none; the method is private in the typings only. A runner of
 * another driver has no such method and is released as before.
 */
async function discardRunner(
  runner: QueryRunner,
  error: unknown
): Promise<void> {
  const postgres = runner as unknown as {
    releasePostgresConnection?: (err: Error) => Promise<void>;
  };
  if (typeof postgres.releasePostgresConnection !== 'function') {
    await runner.release();
    return;
  }
  await postgres.releasePostgresConnection(
    error instanceof Error ? error : new Error(String(error))
  );
}
