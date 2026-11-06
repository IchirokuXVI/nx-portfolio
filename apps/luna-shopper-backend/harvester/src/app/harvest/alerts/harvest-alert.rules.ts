import {
  HarvestAlertKind,
  HarvestRunStatus,
  HarvestRunTrigger,
  HarvestScheduleOutcome,
  type HarvestRunMode,
} from '@portfolio/luna-shopper/contracts';

/**
 * Which outcome makes an alert, as pure functions (plan 0218, sections 2 and
 * 3). No Nest, no database and no clock: every instant is passed in.
 *
 * **Nothing else sends an alert.** An abort of any kind, a busy chain, a late
 * slot, a failing skip and a run that completed with failed items under the
 * ratio all answer null here, on purpose.
 */

/**
 * The consecutive failures at which a chain's schedules stop.
 *
 * The same number as `SOURCE_FAILING_AFTER` in `harvest-run.service.ts`, and
 * a spec holds the two equal. It is not imported from there because that
 * module imports the executor, which imports this one, and a cycle through a
 * Nest provider can leave a constructor's parameter type undefined at boot.
 */
export const SCHEDULES_STOP_AFTER = 3;

/** One alert as the outbox stores it, before it has a row. */
export interface HarvestAlertDraft {
  kind: HarvestAlertKind;
  dedupeKey: string;
  supermarketId: string | null;
  runId: string | null;
  scheduleId: string | null;
  /** Every fact the message needs, so the worker reads no other table. */
  payload: Record<string, unknown>;
}

/** The facts of a run alert, as the payload stores them. */
export interface RunAlertPayload {
  mode: HarvestRunMode;
  trigger: HarvestRunTrigger;
  presetId: string | null;
  scheduleId: string | null;
  adapterKey: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string;
  failed: number;
  totalPlanned: number | null;
  error: string | null;
  /** The schedules that stopped with this failure, or null (section 2.2). */
  schedulesStopped: number | null;
  /** The reaper's window, for a `RUN_STALE` alert only. */
  staleAfterSeconds: number | null;
}

/** The facts of a refused slot. */
export interface SlotAlertPayload {
  presetId: string;
  scheduleId: string;
  adapterKey: string | null;
  slot: string;
  retry: boolean;
  note: string | null;
  at: string;
}

/** The facts of a postal code the queue gave up on. */
export interface PostalCodeAlertPayload {
  postalCode: string;
  country: string;
  attempts: number;
  error: string;
  runId: string | null;
  at: string;
}

/** The facts of a test. */
export interface TestAlertPayload {
  requestedByUserId: string;
  at: string;
}

/** What a run alert needs to know about the run. */
export interface RunAlertRun {
  id: string;
  mode: HarvestRunMode;
  trigger: HarvestRunTrigger;
  supermarketId: string | null;
  presetId: string | null;
  scheduleId: string | null;
  requestedAt: Date | null;
  startedAt: Date | null;
  failed: number;
  totalPlanned: number | null;
}

/**
 * Whether the executor must count the chain's schedules that are on before
 * it can decide (section 3): only a `FAILED` run that takes the counter to
 * exactly {@link SCHEDULES_STOP_AFTER}. The count costs nothing on any other
 * run, because it is not read.
 */
export function needsScheduleCount(
  status: HarvestRunStatus,
  failuresBefore: number | null
): boolean {
  return (
    status === HarvestRunStatus.FAILED &&
    failuresBefore === SCHEDULES_STOP_AFTER - 1
  );
}

/**
 * The alert of a finished run, or null (sections 2, 2.1 and 2.2).
 *
 * - `FAILED` of a `MANUAL` or `SCHEDULED` run is `RUN_FAILED`, or
 *   `RUN_BLOCKED` when the run stopped on a chain refusal. `refusal` is the
 *   `stopReason` that `finish` writes, never the class of a caught error.
 * - `FAILED` of a `SYSTEM` run is null, unless it takes the counter to 3
 *   with a schedule on: the stop is about the chain, whoever started the run.
 * - `STALE` of any trigger is `RUN_STALE` (the owner, 2026-11-05).
 * - Anything else is null.
 */
export function runAlertFor(input: {
  run: RunAlertRun;
  status: HarvestRunStatus;
  error: string | null;
  refusal: boolean;
  adapterKey: string | null;
  /** The source's counter before this run's verdict, null with no source. */
  failuresBefore: number | null;
  enabledSchedules: number;
  finishedAt: Date;
  /** The reaper's window, for a `STALE` run. */
  staleAfterSeconds?: number;
}): HarvestAlertDraft | null {
  const { run, status } = input;
  let kind: HarvestAlertKind;
  let schedulesStopped: number | null = null;
  if (status === HarvestRunStatus.STALE) {
    kind = HarvestAlertKind.RUN_STALE;
  } else if (status === HarvestRunStatus.FAILED) {
    schedulesStopped =
      needsScheduleCount(status, input.failuresBefore) &&
      input.enabledSchedules > 0
        ? input.enabledSchedules
        : null;
    const byAPersonOrASchedule =
      run.trigger === HarvestRunTrigger.MANUAL ||
      run.trigger === HarvestRunTrigger.SCHEDULED;
    if (!byAPersonOrASchedule && schedulesStopped === null) {
      return null;
    }
    kind = input.refusal
      ? HarvestAlertKind.RUN_BLOCKED
      : HarvestAlertKind.RUN_FAILED;
  } else {
    return null;
  }
  const payload: RunAlertPayload = {
    mode: run.mode,
    trigger: run.trigger,
    presetId: run.presetId ?? null,
    scheduleId: run.scheduleId ?? null,
    adapterKey: input.adapterKey,
    requestedAt: isoOrNull(run.requestedAt),
    startedAt: isoOrNull(run.startedAt),
    finishedAt: input.finishedAt.toISOString(),
    failed: Number(run.failed ?? 0),
    totalPlanned: run.totalPlanned ?? null,
    error: input.error,
    schedulesStopped,
    staleAfterSeconds:
      kind === HarvestAlertKind.RUN_STALE
        ? (input.staleAfterSeconds ?? null)
        : null,
  };
  return {
    kind,
    dedupeKey: `run:${run.id}`,
    supermarketId: run.supermarketId ?? null,
    runId: run.id,
    scheduleId: run.scheduleId ?? null,
    payload: { ...payload },
  };
}

/** What a slot alert needs to know about the schedule, as the claim read it. */
export interface SlotAlertSchedule {
  id: string;
  presetId: string;
  supermarketId: string;
  lastOutcome: HarvestScheduleOutcome | null;
  lastOutcomeNote: string | null;
}

/**
 * The alert of a refused slot or retry, or null (section 2.3).
 *
 * A `REFUSED` slot alerts **unless the previous outcome of the same schedule
 * was `REFUSED` with the same note**, so a daily schedule whose chain row is
 * off sends one mail and not one a day. `schedule` is the row as it was
 * before the claim. A refused retry always alerts: the outcome before it is
 * the `STARTED` of the run it retries.
 */
export function slotAlertFor(input: {
  schedule: SlotAlertSchedule;
  slot: Date;
  retry: boolean;
  result: { outcome: HarvestScheduleOutcome; note: string | null };
  adapterKey: string | null;
  at: Date;
}): HarvestAlertDraft | null {
  const { schedule, result } = input;
  if (result.outcome !== HarvestScheduleOutcome.REFUSED) {
    return null;
  }
  if (
    !input.retry &&
    schedule.lastOutcome === HarvestScheduleOutcome.REFUSED &&
    (schedule.lastOutcomeNote ?? null) === (result.note ?? null)
  ) {
    return null;
  }
  const slot = input.slot.toISOString();
  const payload: SlotAlertPayload = {
    presetId: schedule.presetId,
    scheduleId: schedule.id,
    adapterKey: input.adapterKey,
    slot,
    retry: input.retry,
    note: result.note ?? null,
    at: input.at.toISOString(),
  };
  return {
    kind: HarvestAlertKind.SLOT_REFUSED,
    dedupeKey: `slot:${schedule.id}:${slot}${input.retry ? ':retry' : ''}`,
    supermarketId: schedule.supermarketId,
    runId: null,
    scheduleId: schedule.id,
    payload: { ...payload },
  };
}

/** What a postal code alert needs to know about the queue row. */
export interface PostalCodeAlertRequest {
  id: string;
  postalCode: string;
  country: string;
  /** The attempts the claim counted, this one included. */
  attempts: number;
  lastAttemptedAt: Date | null;
}

/**
 * The alert of a postal code the queue gives up on, or null (the owner,
 * 2026-11-05).
 *
 * Only the attempt that leaves the row `FAILED` alerts, by the rule
 * `markAttemptFailed` applies, so a code is one mail when it gives up and
 * never one per attempt. The key names the run that ended it, or the attempt
 * when no run started, so a code that gives up again a month later after a
 * requeue is a new mail.
 */
export function postalCodeAlertFor(input: {
  request: PostalCodeAlertRequest;
  maxAttempts: number;
  error: string;
  runId: string | null;
  at: Date;
}): HarvestAlertDraft | null {
  const { request } = input;
  if (request.attempts < input.maxAttempts) {
    return null;
  }
  const attempt =
    input.runId ??
    `attempt-${request.id}-${(request.lastAttemptedAt ?? input.at).getTime()}`;
  const payload: PostalCodeAlertPayload = {
    postalCode: request.postalCode,
    country: request.country,
    attempts: request.attempts,
    error: input.error,
    runId: input.runId,
    at: input.at.toISOString(),
  };
  return {
    kind: HarvestAlertKind.POSTAL_CODE_FAILED,
    dedupeKey: `code:${request.postalCode}:${attempt}`,
    supermarketId: null,
    runId: input.runId,
    scheduleId: null,
    payload: { ...payload },
  };
}

/** A test alert a person asked for (section 7). `id` makes its key unique. */
export function testAlertFor(input: {
  id: string;
  userId: string;
  at: Date;
}): HarvestAlertDraft {
  const payload: TestAlertPayload = {
    requestedByUserId: input.userId,
    at: input.at.toISOString(),
  };
  return {
    kind: HarvestAlertKind.TEST,
    dedupeKey: `test:${input.id}`,
    supermarketId: null,
    runId: null,
    scheduleId: null,
    payload: { ...payload },
  };
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
