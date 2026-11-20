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
  type SlotHold,
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
 * Thrown by the probe gate when a slot cannot be decided: the probe ended
 * `ABORTED`, or the harvester is stopping (plan 0247, review round 1). It
 * leaves `startScheduled` before the insert, and the worker turns it into no
 * outcome and no alert.
 */
class GateInterrupted extends Error {}

/**
 * The note of an undecided slot that is too late by the time its retry comes
 * (plan 0247, review round 2).
 */
export const UNDECIDED_LATE_NOTE =
  'not decided in time, a stop interrupted its gate';

/** What a start answers: an outcome to write, or a slot left undecided. */
type SlotResult = ScheduledStart | { interrupted: string };

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
 *
 * **A deploy during the gate decides nothing.** A probe that ended `ABORTED`,
 * or a gate the shutdown stopped, writes no outcome and no alert. The slot
 * stays claimed and undecided, and the retry after the restart runs it one
 * time through the same gate, as it does a run a shutdown stopped.
 *
 * Each outcome is stamped with the clock when it is decided, and each slot is
 * judged late by the clock when it is reached, because a gate can hold a tick
 * for minutes. The claim keeps the time of the tick.
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
      await this.retryInterrupted();
      await this.retryUndecided();
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
        await this.decideHeld(claimed);
      } catch (error) {
        // The slot is spent by its claim. When it started no run, it has no
        // outcome, and the retry of an undecided slot takes it one time on a
        // later tick. The next schedule still gets its turn.
        this.logger.error(
          `Schedule ${claimed.schedule.id} could not record its slot: ` +
            describeError(error).message
        );
      }
    }
  }

  /**
   * Decide a claimed slot while holding its schedule, so the retry of an
   * undecided slot in another process leaves it alone until this ends. A
   * hold that another process has, or a slot it decided in the instant
   * between the claim and the hold, is that process's to decide.
   */
  private async decideHeld(claimed: ClaimedSlot): Promise<void> {
    const { schedule, slot } = claimed;
    const hold = await this.store.holdSlot(schedule.id);
    if (!hold) {
      this.logger.log(
        `Schedule ${schedule.id}: the slot of ${slot.toISOString()} is held ` +
          'elsewhere, so this process leaves it.'
      );
      return;
    }
    try {
      if (await this.store.isUndecided(schedule.id, slot)) {
        await this.decide(claimed);
      }
    } finally {
      await this.letGo(hold, schedule.id);
    }
  }

  /**
   * Release a hold and never throw, so a failed release cannot hide the
   * error of the decision it held, nor turn a decided slot into a failure.
   * The store destroys a connection whose unlock failed, which frees the lock.
   */
  private async letGo(hold: SlotHold, scheduleId: string): Promise<void> {
    try {
      await hold.release();
    } catch (error) {
      this.logger.error(
        `Schedule ${scheduleId} could not release the hold of its slot: ` +
          describeError(error).message
      );
    }
  }

  /** What becomes of one claimed slot (section 5.3). */
  private async decide(claimed: ClaimedSlot): Promise<void> {
    const { schedule, slot } = claimed;
    // The clock when this slot is reached, not when the tick began: a gate
    // before it may have held the tick for minutes.
    const reached = this.clock();
    const result: SlotResult = isTooLate(schedule, slot, reached)
      ? {
          outcome: HarvestScheduleOutcome.SKIPPED_LATE,
          note:
            `The slot of ${slot.toISOString()} was reached at ` +
            `${reached.toISOString()}, more than half of the gap to the next ` +
            'slot late.',
          runId: null,
        }
      : await this.start(schedule);
    if ('interrupted' in result) {
      this.logInterrupted(schedule, slot, result.interrupted, false, false);
      return;
    }
    const at = this.clock();
    await this.store.recordOutcome(
      schedule.id,
      {
        ...result,
        at,
        // A started slot is attempt 1. Any other leaves the 0 the claim wrote,
        // so no retry can fire for a slot that started nothing.
        attempts: result.runId ? 1 : null,
      },
      // A refused slot tells the owner, in the same write (plan 0218,
      // section 2.3). `schedule` is the row before the claim, so its last
      // outcome is the one this slot is compared with.
      ...(await this.namedAlertArgument(schedule, slot, false, result, at))
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
  private async retryInterrupted(): Promise<void> {
    const candidates = await this.store.findInterrupted();
    for (const schedule of candidates) {
      if (this.stopping) {
        return;
      }
      const slot = schedule.lastSlotAt;
      const stopped = schedule.lastRunId;
      if (!slot || !stopped || isTooLate(schedule, slot, this.clock())) {
        continue;
      }
      try {
        if (!(await this.store.claimRetry(schedule.id, stopped))) {
          continue;
        }
        await this.retry(schedule, slot);
      } catch (error) {
        this.logger.error(
          `Schedule ${schedule.id} could not retry run ${stopped}: ` +
            describeError(error).message
        );
      }
    }
  }

  /**
   * Decide, one time, each slot that was claimed and never decided, because a
   * shutdown came during its probe gate (plan 0247, review round 1). The same
   * rules as {@link retryInterrupted}: claimed before it runs and spent
   * whatever it answers, and the same gate.
   *
   * **This is the slot's first decision, not a retry of one.** The row's last
   * outcome is the previous slot's, so the alert rules compare with it as they
   * do for any slot, and the key is the slot's own (review round 2).
   *
   * **A slot that is too late is recorded, not left.** It is written as
   * `SKIPPED_LATE`, which alerts no one, so the schedule view stops showing
   * the previous slot's outcome as the last one and the row is not found
   * again on every tick.
   */
  private async retryUndecided(): Promise<void> {
    const candidates = await this.store.findUndecided();
    for (const schedule of candidates) {
      if (this.stopping) {
        return;
      }
      const slot = schedule.lastSlotAt;
      if (!slot) {
        continue;
      }
      try {
        // Held first: a slot a live worker is still deciding is held by it,
        // and is not undecided but in progress.
        const hold = await this.store.holdSlot(schedule.id);
        if (!hold) {
          continue;
        }
        try {
          if (!(await this.store.claimUndecided(schedule.id, slot))) {
            continue;
          }
          if (isTooLate(schedule, slot, this.clock())) {
            await this.recordUndecidedLate(schedule, slot);
          } else {
            await this.retry(schedule, slot, { firstDecision: true });
          }
        } finally {
          await this.letGo(hold, schedule.id);
        }
      } catch (error) {
        this.logger.error(
          `Schedule ${schedule.id} could not retry the undecided slot of ` +
            `${slot.toISOString()}: ${describeError(error).message}`
        );
      }
    }
  }

  /**
   * The start of a claimed retry and its outcome. The attempts stay at the 2
   * the retry's claim wrote, started or not, and a retry the gate leaves
   * undecided writes nothing and is spent.
   *
   * `firstDecision` marks an undecided slot: its attempts are 2 like any
   * retry's, which bounds it to this one chance, and the alert and the log
   * treat it as the slot itself.
   */
  private async retry(
    schedule: HarvestSchedule,
    slot: Date,
    { firstDecision }: { firstDecision: boolean } = { firstDecision: false }
  ): Promise<void> {
    const retry = !firstDecision;
    const result = await this.start(schedule);
    if ('interrupted' in result) {
      this.logInterrupted(schedule, slot, result.interrupted, retry, true);
      return;
    }
    const at = this.clock();
    await this.store.recordOutcome(
      schedule.id,
      {
        ...result,
        at,
        attempts: null,
      },
      ...(await this.namedAlertArgument(schedule, slot, retry, result, at))
    );
    this.log(schedule, slot, result, retry);
  }

  /**
   * An undecided slot that is too late when its retry comes, written as
   * `SKIPPED_LATE`. The 2 the claim wrote stays, so the row is not found
   * again. The late rule has no alert, so neither has this.
   */
  private async recordUndecidedLate(
    schedule: HarvestSchedule,
    slot: Date
  ): Promise<void> {
    const result: ScheduledStart = {
      outcome: HarvestScheduleOutcome.SKIPPED_LATE,
      note: UNDECIDED_LATE_NOTE,
      runId: null,
    };
    await this.store.recordOutcome(schedule.id, {
      ...result,
      at: this.clock(),
      attempts: null,
    });
    this.log(schedule, slot, result, false);
  }

  /** The start, with anything unexpected written as `REFUSED` (section 5.3). */
  private async start(schedule: HarvestSchedule): Promise<SlotResult> {
    try {
      return await this.runs.startScheduled(schedule, (check) =>
        this.probeGate(schedule, check)
      );
    } catch (error) {
      if (error instanceof GateInterrupted) {
        return { interrupted: error.message };
      }
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
      } else if (this.isStopping()) {
        // The probe service refuses a probe once it is stopping.
        throw new GateInterrupted(
          'the harvester is stopping, so no probe of the chain started'
        );
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
      const waited = await this.waitFor(decision.probe);
      if (waited.status === SourceProbeStatus.RUNNING && this.isStopping()) {
        throw new GateInterrupted(
          `the harvester stopped while it waited for probe ${waited.id}`
        );
      }
      decision = judgeGateProbe(waited);
    }
    if (decision.action === 'INTERRUPTED') {
      throw new GateInterrupted(decision.note);
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

  /** Whether this worker or the probe service is on its way out. */
  private isStopping(): boolean {
    return this.stopping || this.probes.isStopping();
  }

  /**
   * Read a running probe every {@link PROBE_POLL_MS} until it finishes, or
   * until the reaper's ten minutes and one of its ticks passed since it
   * started (section 2, step 5). Answers the probe as last read, which is
   * still `RUNNING` when the wait ran out or the harvester began to stop.
   */
  private async waitFor(probe: GateProbe): Promise<GateProbe> {
    let current = probe;
    while (!this.isStopping() && !waitIsOver(current, this.clock())) {
      await this.sleep(PROBE_POLL_MS);
      current = gateProbeOf(await this.probeStore.load(current.id));
    }
    return current;
  }

  /** The one line of a slot the gate left undecided. */
  private logInterrupted(
    schedule: HarvestSchedule,
    slot: Date,
    note: string,
    retry: boolean,
    spent: boolean
  ): void {
    const what = retry ? 'retry of the slot' : 'slot';
    this.logger.log(
      `Schedule ${schedule.id}: ${what} of ${slot.toISOString()} is not ` +
        `decided, ${note}. ` +
        (spent
          ? 'Its one retry is spent.'
          : 'A retry on a later tick decides it one time.')
    );
  }

  /**
   * {@link alertArgument}, with the preset's name on a drafted alert (plan
   * 0255). The draft comes first, so a slot that does not alert, or that
   * repeats the refusal before it, reads no name. `presetNameOf` never
   * throws: a name it cannot read is null, and the mail keeps the uuid line.
   */
  private async namedAlertArgument(
    schedule: HarvestSchedule,
    slot: Date,
    retry: boolean,
    result: ScheduledStart,
    at: Date
  ): Promise<[] | [HarvestAlertDraft]> {
    const argument = alertArgument(schedule, slot, retry, result, at);
    for (const alert of argument) {
      alert.payload['presetName'] = await this.store.presetNameOf(
        schedule.presetId
      );
    }
    return argument;
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
