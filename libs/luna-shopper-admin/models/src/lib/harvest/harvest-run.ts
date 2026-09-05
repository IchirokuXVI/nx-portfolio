import type * as Wire from '../wire/wire-types';

/**
 * A run, as the gateway describes it (plan 0006, section 2).
 *
 * The wire type is the view model, which is `0004` section 2's deliberate
 * exception to rule D4 and is why there is no mapping layer here. What this file
 * adds is the handful of questions the run screen asks that a bare shape cannot
 * answer: whether it is still going, how far along it is, and why it will not
 * start.
 */
export type HarvestRun = Wire.HarvestHarvestRunView;

export type HarvestRunStatus = Wire.EnumsHarvestRunStatus;
export type HarvestRunMode = Wire.EnumsHarvestRunMode;

/**
 * The statuses a run never leaves.
 *
 * Polling stops on these and on nothing else (section 2). `STALE` is one of
 * them: the harvester's own reaper writes it when a run stops sending a
 * heartbeat, so the process behind it is gone and no further poll will report
 * anything new.
 */
export const TERMINAL_RUN_STATUSES: readonly HarvestRunStatus[] = [
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'STALE',
];

/** Whether this run has finished, however it finished. */
export function isTerminalRun(run: HarvestRun | null): boolean {
  return run !== null && TERMINAL_RUN_STATUSES.includes(run.status);
}

/**
 * Whether asking this run to stop is still a thing that can happen.
 *
 * A terminal run cannot be aborted, and a run that has already been asked is not
 * asked twice: `abortRequestedAt` is set the moment the request lands, while the
 * status stays `RUNNING` until the run flushes what it has and finalizes. A
 * button that stayed live through that window would offer an operator a second
 * abort that does nothing, in the exact minutes they are most likely to press
 * it again.
 */
export function canAbort(run: HarvestRun | null): boolean {
  return run !== null && !isTerminalRun(run) && run.abortRequestedAt === null;
}

/**
 * The modes that write prices, and therefore the only ones a revert applies to
 * (backend plan 0082, section 5).
 *
 * A `STORE_DISCOVERY` run finds shops and writes no price, so there is nothing
 * for a revert to take back and the backend refuses one.
 *
 * `REFRESH` is gone (backend plan 0086, section 9). It existed only because a
 * walk threw its prices away and something had to fetch them again; a walk
 * writes them now, so the mode had nothing left to do. `LEAFLET_IMPORT` is
 * `FILE_IMPORT` for the same reason the upload screen is an import screen: what
 * arrives in a file is a run that happened somewhere else, and a leaflet is only
 * one of the things that produces one.
 */
export const PRICE_WRITING_MODES: readonly HarvestRunMode[] = [
  'FILE_IMPORT',
  'CATALOG_DISCOVERY',
];

/**
 * What a run's `updated` and `unchanged` counters are called on its own screen
 * (admin plan 0014, section 3).
 *
 * A walk writes prices now, so on a price writing run those two counters are
 * prices written and prices confirmed, which is what the ingest actually counted
 * (backend plan 0086, section 5). On a store discovery they are shops, so they
 * keep the neutral labels: naming a shop a price would be worse than saying
 * nothing.
 *
 * The keys rather than the words, because the words are translated where they
 * are drawn and this library holds no copy of them.
 */
export function runCounterKeys(run: HarvestRun): {
  readonly updated: string;
  readonly unchanged: string;
} {
  return PRICE_WRITING_MODES.includes(run.mode)
    ? { updated: 'pricesWritten', unchanged: 'pricesConfirmed' }
    : { updated: 'updated', unchanged: 'unchanged' };
}

/** Whether this run's writes have already been taken back. */
export function isReverted(run: HarvestRun | null): boolean {
  return run !== null && run.revertedAt !== null;
}

/**
 * Whether taking this run's writes back is a thing that can still happen.
 *
 * Three conditions, and each of them is a different refusal on the server. The
 * run has finished, because a revert deletes what an abort keeps: a run still
 * going is aborted first and reverted after. Its mode writes prices, because
 * reverting a store discovery would mark an act that deleted nothing. And it
 * has not been reverted already, because there would be nothing left to take.
 *
 * Asked here so the button is absent rather than present and answered with a
 * 409. The server checks all three again: this is which control to draw, not a
 * gate.
 */
export function canRevert(run: HarvestRun | null): boolean {
  return (
    run !== null &&
    isTerminalRun(run) &&
    !isReverted(run) &&
    PRICE_WRITING_MODES.includes(run.mode)
  );
}

/** How far along a run is, in the three numbers the screen draws. */
export interface RunProgress {
  readonly processed: number;
  /** What the run expects to do, once it knows. Null before the tree walk. */
  readonly total: number | null;
  /** 0 to 100, or null when nothing yet says what the whole is. */
  readonly percent: number | null;
}

/**
 * A run's progress, with the unknown case kept unknown.
 *
 * `totalPlanned` is null until the catalog walk has finished counting, which is
 * several minutes into an eighteen minute run. A screen that filled that gap
 * with a guess would show a bar moving against a denominator nobody chose, so
 * the percentage stays null and the screen says how many rather than how far.
 */
export function runProgress(run: HarvestRun): RunProgress {
  const total = run.totalPlanned;
  const usable = total !== null && total > 0;

  return {
    processed: run.processed,
    total,
    percent: usable
      ? Math.min(100, Math.round((run.processed / total) * 100))
      : null,
  };
}

/**
 * Why a run will not start, in the vocabulary of section 3's switches.
 *
 * `service-off` is `HARVEST_ENABLED` and `chain-disabled` is the per chain flag
 * this app can actually change, which since backend plan `0083` is the only per
 * chain switch there is. The third is the honest one: no route reports the
 * first until something has been attempted, so before an attempt the answer is
 * that nothing is known.
 */
export type RunBlockReason = 'service-off' | 'chain-disabled' | 'unknown';

/**
 * What a failure to start meant, read from what the server actually said.
 *
 * The harvester refuses a spawn with `HARVEST_ENABLED` false as a
 * `NotConfiguredException`, which reaches this app as a 501 carrying
 * `not_configured`. That is a statement about the deployment rather than about
 * the request, and it is the one switch whose state the app can learn without a
 * route that reports it.
 */
export function spawnBlockReason(error: {
  readonly code: string;
  readonly status: number;
}): RunBlockReason | null {
  return error.code === 'not_configured' || error.status === 501
    ? 'service-off'
    : null;
}

/**
 * What a finished run's own error message meant.
 *
 * There used to be a second reason read here, `storefront-off`, from a run that
 * started and whose runner refused on its first step because a variable named
 * after that storefront was false. Backend plan `0083` deleted that variable: a
 * chain is switched off by its own source row, which refuses the spawn instead,
 * so no run finalizes with a storefront refusal any more and the reason went
 * with it.
 *
 * Matching on the variable's name rather than on the whole sentence, because the
 * name is the part of that message that is a contract with anything.
 */
export function failureBlockReason(run: HarvestRun): RunBlockReason | null {
  return (run.error ?? '').includes('HARVEST_ENABLED') ? 'service-off' : null;
}
