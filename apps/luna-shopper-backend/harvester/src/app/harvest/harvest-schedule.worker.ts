import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestScheduleOutcome,
  SourceProbeStatus,
} from '@portfolio/luna-shopper/contracts';
import { describeError } from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestSchedule } from '../entities';
import {
  slotAlertFor,
  type HarvestAlertDraft,
} from './alerts/harvest-alert.rules';
import {
  HarvestRunService,
  type ScheduledStart,
  type ScheduledStartCheck,
} from './harvest-run.service';
import {
  HarvestScheduleStore,
  type ClaimedSlot,
} from './harvest-schedule.store';
import { isProbedAdapterKey } from './probes/source-probe.runner';
import { SourceProbeService } from './probes/source-probe.service';
import { SourceProbeStore } from './probes/source-probe.store';
import {
  PROBE_DID_NOT_FINISH,
  PROBE_POLL_MS,
  PROBE_VALID_MS,
  decideProbeGate,
  judgeGateProbe,
  waitIsOver,
  type GateProbe,
} from './schedule-probe-gate';
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
 *
 * **A probe gates each start** (plan 0247). After the late, failing and busy
 * rules and before the run is inserted, a slot whose preset reads the chain
 * starts only when a probe of the chain passed inside the last 15 minutes. It
 * otherwise waits for a probe that is running or runs one, inside the tick,
 * and is skipped as `SKIPPED_PROBE_FAILED` when that probe is not `PASSED`.
 * The retry of an interrupted run passes the same gate.
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
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock,
    private readonly probes: SourceProbeService,
    private readonly probeStore: SourceProbeStore
  ) {}

  /**
   * How the gate waits between two reads of a running probe. A field so a
   * spec can move its clock instead of waiting.
   */
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });

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
    await this.store.recordOutcome(
      schedule.id,
      {
        ...result,
        at: now,
        // A started slot is attempt 1. Any other leaves the 0 the claim wrote,
        // so no retry can fire for a slot that started nothing.
        attempts: result.runId ? 1 : null,
      },
      // A refused slot tells the owner, in the same write (plan 0218,
      // section 2.3). `schedule` is the row before the claim, so its last
      // outcome is the one this slot is compared with.
      ...alertArgument(schedule, slot, false, result, now)
    );
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
        await this.store.recordOutcome(
          schedule.id,
          {
            ...result,
            at: now,
            attempts: null,
          },
          ...alertArgument(schedule, slot, true, result, now)
        );
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
      return await this.runs.startScheduled(schedule, (check) =>
        this.probeGate(schedule, check)
      );
    } catch (error) {
      return {
        outcome: HarvestScheduleOutcome.REFUSED,
        note: describeError(error).message,
        runId: null,
      };
    }
  }

  /**
   * The probe gate of one start (plan 0247, section 2, steps 3 to 7): null
   * lets the run start, an outcome skips the slot. It runs after the late,
   * failing and busy rules, which `startScheduled` applied before calling it.
   */
  private async probeGate(
    schedule: HarvestSchedule,
    { source, mode }: ScheduledStartCheck
  ): Promise<ScheduledStart | null> {
    if (!source) {
      return null;
    }
    const now = this.clock();
    let decision = decideProbeGate({
      mode,
      adapterKey: source.adapterKey,
      probed: isProbedAdapterKey(source.adapterKey),
      probes: await this.probeStore.gateProbes(
        source.id,
        new Date(now.getTime() - PROBE_VALID_MS)
      ),
      now,
    });
    if (decision.action === 'PROBE') {
      const ran = await this.probes.runForSchedule(source, schedule.id);
      if (ran) {
        decision = judgeGateProbe(gateProbeOf(ran));
      } else {
        // Another probe of the source started between the read and the
        // insert, and is waited for as any running probe is. If it already
        // finished, its row is the verdict.
        const running = await this.probeStore.findRunning(source.id);
        const newest = running ? null : await this.newestFinished(source.id);
        decision = running
          ? { action: 'WAIT', probe: gateProbeOf(running) }
          : newest
            ? judgeGateProbe(newest)
            : { action: 'SKIP', note: PROBE_DID_NOT_FINISH };
      }
    }
    if (decision.action === 'WAIT') {
      decision = judgeGateProbe(await this.waitFor(decision.probe));
    }
    if (decision.action === 'START') {
      return null;
    }
    // A skip, and any decision that is not a start: a slot never starts
    // without a probe that passed.
    return {
      outcome: HarvestScheduleOutcome.SKIPPED_PROBE_FAILED,
      note: decision.action === 'SKIP' ? decision.note : PROBE_DID_NOT_FINISH,
      runId: null,
    };
  }

  /** The newest probe of a source inside the window that is not `RUNNING` or `ABORTED`. */
  private async newestFinished(sourceId: string): Promise<GateProbe | null> {
    const probes = await this.probeStore.gateProbes(
      sourceId,
      new Date(this.clock().getTime() - PROBE_VALID_MS)
    );
    return (
      probes.find(
        (probe) =>
          probe.status !== SourceProbeStatus.RUNNING &&
          probe.status !== SourceProbeStatus.ABORTED
      ) ?? null
    );
  }

  /**
   * Read a running probe every {@link PROBE_POLL_MS} until it finishes, or
   * until six minutes passed since it started (section 2, step 5). Answers
   * the probe as last read, which is still `RUNNING` when the wait ran out.
   */
  private async waitFor(probe: GateProbe): Promise<GateProbe> {
    let current = probe;
    while (!this.stopping && !waitIsOver(current, this.clock())) {
      await this.sleep(PROBE_POLL_MS);
      current = gateProbeOf(await this.probeStore.load(current.id));
    }
    return current;
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

/** A probe row as the gate reads it. */
function gateProbeOf(row: {
  id: string;
  status: SourceProbeStatus;
  startedAt: Date;
  error: string | null;
}): GateProbe {
  return {
    id: row.id,
    status: row.status,
    startedAt: new Date(row.startedAt),
    error: row.error ?? null,
  };
}

/**
 * The third argument of `recordOutcome` for a slot that alerts, and none for
 * any other, so an outcome that was always two arguments stays two.
 */
function alertArgument(
  schedule: HarvestSchedule,
  slot: Date,
  retry: boolean,
  result: ScheduledStart,
  at: Date
): [] | [HarvestAlertDraft] {
  const alert = slotAlertFor({
    schedule,
    slot,
    retry,
    result,
    // The worker reads no source row. The message names the chain from
    // catalog at send time and falls back to the chain's id.
    adapterKey: null,
    at,
  });
  return alert ? [alert] : [];
}
