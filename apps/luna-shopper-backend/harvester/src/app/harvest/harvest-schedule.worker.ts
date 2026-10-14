import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HarvestScheduleOutcome } from '@portfolio/luna-shopper/contracts';
import { describeError } from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestSchedule } from '../entities';
import { HarvestRunService, type ScheduledStart } from './harvest-run.service';
import {
  HarvestScheduleStore,
  type ClaimedSlot,
} from './harvest-schedule.store';
import { HARVEST_CLOCK, isTooLate, type HarvestClock } from './schedule-slot';

/** How often the worker looks for a due schedule. A constant, not a setting. */
export const SCHEDULE_TICK_MS = 60_000;

/**
 * Starts the preset of each schedule that is due (plan 0206, section 5).
 *
 * **A poll over a column, not a registry of timers.** A timer that lives in
 * memory misses a slot that falls inside a restart and fires in every process
 * when there are two. This reads `nextRunAt`, claims a due row in one
 * transaction, and decides what to do with the slot after the claim commits.
 *
 * A tick does nothing unless `HARVEST_ENABLED` and `HARVEST_SCHEDULER_ENABLED`
 * are both true, and then does two things in order: the retry of a run a
 * shutdown stopped (section 7), then the due schedules. One tick runs at a
 * time in a process, and nothing a tick meets is thrown out of it.
 *
 * The lifecycle is the postal code worker's: a plain timer with `unref`, no
 * scheduler dependency, cleared on destroy, and a flag that stops the loop on
 * the way out. The executor's own shutdown hook aborts the run in flight.
 */
@Injectable()
export class HarvestScheduleWorker
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(HarvestScheduleWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopping = false;

  constructor(
    private readonly store: HarvestScheduleStore,
    private readonly runs: HarvestRunService,
    private readonly config: ConfigService,
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  onModuleInit(): void {
    const settings = this.settings();
    if (!settings.schedulerEnabled) {
      this.logger.log(
        'HARVEST_SCHEDULER_ENABLED is false: no schedule starts a run here. ' +
          'A person can still start one.'
      );
    } else if (!settings.harvestEnabled) {
      this.logger.log(
        'HARVEST_SCHEDULER_ENABLED is true and HARVEST_ENABLED is false: no ' +
          'schedule starts a run until both are true.'
      );
    }
    this.timer = setInterval(() => void this.tick(), SCHEDULE_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  /** One pass: the retries, then every due slot. Public for the specs. */
  async tick(): Promise<void> {
    const settings = this.settings();
    if (
      this.ticking ||
      this.stopping ||
      !settings.harvestEnabled ||
      !settings.schedulerEnabled
    ) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.clock();
      await this.retryInterrupted(now);
      await this.fireDue(now);
    } catch (error) {
      // A timer has no caller to return an error to, so it must never take
      // the process down. The next tick starts again from the table.
      this.logger.error(
        `Schedule tick failed: ${describeError(error).message}`
      );
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Claim due slots one at a time until none is left. A claim moves
   * `nextRunAt` past `now`, so each schedule is claimed at most once a tick.
   */
  private async fireDue(now: Date): Promise<void> {
    while (!this.stopping) {
      const claimed = await this.store.claimDue(now);
      if (!claimed) {
        return;
      }
      try {
        await this.decide(claimed, now);
      } catch (error) {
        // The slot is spent by its claim. Losing its outcome is the cost of
        // never firing it twice, and the next schedule still gets its turn.
        this.logger.error(
          `Schedule ${claimed.schedule.id} could not record its slot: ` +
            describeError(error).message
        );
      }
    }
  }

  /** What becomes of one claimed slot (section 5.3). */
  private async decide(claimed: ClaimedSlot, now: Date): Promise<void> {
    const { schedule, slot } = claimed;
    const result: ScheduledStart = isTooLate(schedule, slot, now)
      ? {
          outcome: HarvestScheduleOutcome.SKIPPED_LATE,
          note:
            `The slot of ${slot.toISOString()} was reached at ` +
            `${now.toISOString()}, more than half of the gap to the next ` +
            'slot late.',
          runId: null,
        }
      : await this.start(schedule);
    await this.store.recordOutcome(schedule.id, {
      ...result,
      at: now,
      // A started slot is attempt 1. Any other leaves the 0 the claim wrote,
      // so no retry can fire for a slot that started nothing.
      attempts: result.runId ? 1 : null,
    });
    this.log(schedule, slot, result, false);
  }

  /**
   * Start again, one time, each scheduled run a shutdown or the reaper ended
   * (section 7). The slot does not move.
   *
   * The retry is claimed before the start with a conditional update, so two
   * processes cannot both start it, and it is spent whether the start works
   * or not: a retry that meets a refusal or a busy chain is not tried again on
   * each tick. A slot that is already too late is left alone, and the next
   * slot starts fresh.
   */
  private async retryInterrupted(now: Date): Promise<void> {
    const candidates = await this.store.findInterrupted();
    for (const schedule of candidates) {
      if (this.stopping) {
        return;
      }
      const slot = schedule.lastSlotAt;
      const stopped = schedule.lastRunId;
      if (!slot || !stopped || isTooLate(schedule, slot, now)) {
        continue;
      }
      try {
        if (!(await this.store.claimRetry(schedule.id, stopped))) {
          continue;
        }
        const result = await this.start(schedule);
        await this.store.recordOutcome(schedule.id, {
          ...result,
          at: now,
          attempts: null,
        });
        this.log(schedule, slot, result, true);
      } catch (error) {
        this.logger.error(
          `Schedule ${schedule.id} could not retry run ${stopped}: ` +
            describeError(error).message
        );
      }
    }
  }

  /** The start, with anything unexpected written as `REFUSED` (section 5.3). */
  private async start(schedule: HarvestSchedule): Promise<ScheduledStart> {
    try {
      return await this.runs.startScheduled(schedule);
    } catch (error) {
      return {
        outcome: HarvestScheduleOutcome.REFUSED,
        note: describeError(error).message,
        runId: null,
      };
    }
  }

  private log(
    schedule: HarvestSchedule,
    slot: Date,
    result: ScheduledStart,
    retry: boolean
  ): void {
    const what = retry ? 'retry of the slot' : 'slot';
    if (result.runId) {
      this.logger.log(
        `Schedule ${schedule.id}: ${what} of ${slot.toISOString()} started ` +
          `run ${result.runId}`
      );
    } else {
      this.logger.warn(
        `Schedule ${schedule.id}: ${what} of ${slot.toISOString()} is ` +
          `${result.outcome}: ${result.note ?? ''}`
      );
    }
  }
}
