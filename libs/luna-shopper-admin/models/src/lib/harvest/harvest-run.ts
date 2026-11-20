import {
  isNarrowedRun as isNarrowedRunByContract,
  walkedUnderSameConfig,
} from '@portfolio/luna-shopper/contracts/run-narrowing';
import type * as Wire from '../wire/wire-types';
import { HarvestAdapterCapabilityTable } from '../wire/wire-types';

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
 * What a run did with prices, in the three numbers its report carries.
 *
 * `recorded` is every price the chain stated, kept on the chain's own source
 * rows, and it is what the source products screen shows. `published` is what
 * reached catalog, which only a row bound to a product earns. `confirmed` is
 * what catalog already held at that value.
 *
 * They are read from the report and not from `updated` and `unchanged`, which
 * is where the screen took them before and why a LIDL walk read "prices
 * written: 0" beside 8,154 prices on its own rows. Those two counters are rows
 * the ladder changed and rows it left alone. The harvester once added its price
 * inserts to `updated` as well, so the number was two unrelated things summed.
 * Since backend plan 0217 no price moves a counter.
 *
 * Null when the report names none of the three: a store discovery writes no
 * price, and a run that finished before the harvester reported them has nothing
 * to show rather than three zeros that would read as a run that found nothing.
 */
export interface RunPriceCounters {
  readonly recorded: number;
  readonly published: number;
  readonly confirmed: number;
}

export function runPriceCounters(run: HarvestRun): RunPriceCounters | null {
  const recorded = countIn(run.report, 'pricesRecorded');
  const published = countIn(run.report, 'pricesPublished');
  const confirmed = countIn(run.report, 'pricesConfirmed');
  if (recorded === null && published === null && confirmed === null) {
    return null;
  }
  return {
    recorded: recorded ?? 0,
    published: published ?? 0,
    confirmed: confirmed ?? 0,
  };
}

/**
 * The prices a run published to catalog, as its report states them (backend
 * plan 0217), for the "Prices" column of the runs list.
 *
 * Read from `pricesPublished` alone, so it is null for a run whose report has
 * no such key: a store discovery, or a run that finished before the harvester
 * reported it. A zero would read as a run that published nothing.
 */
export function runPricesPublished(run: HarvestRun): number | null {
  return countIn(run.report, 'pricesPublished');
}

/** One number out of the report bag, which is free form and untyped. */
function countIn(report: Record<string, unknown>, key: string): number | null {
  const value = report[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

/** How far along a run is, in the numbers the screen draws. */
export interface RunProgress {
  readonly processed: number;
  /** What the run expects to do, once it knows. Null before the tree walk. */
  readonly total: number | null;
  /**
   * 0 to 100, or null when nothing yet says what the whole is. Against
   * {@link about} while the run is still going, and then never 100. Null for
   * an ended run measured against {@link about}, because a bar on a run that
   * has stopped reads as progress.
   */
  readonly percent: number | null;
  /**
   * A total taken from another run, for a run that does not know its own
   * (decision 86 of the harvester round). Null or absent when the run knows
   * its total, when no other run gives one, when the run processed nothing,
   * when the run completed, when the run has already done more than it
   * says, and when the run's adapter counts walks that cannot be compared
   * (owner decision 127b). Never a promise: the
   * screen says "about" and calls it an estimate.
   */
  readonly about?: number | null;
  /**
   * Whether the run has ended, so the estimate is worded in the past and drawn
   * with no bar. Only meaningful beside {@link about}.
   */
  readonly ended?: boolean;
}

/**
 * The highest percentage a bar drawn against an approximate total shows.
 *
 * Below full, so a bar measured against an earlier run never says that this
 * run is done. Only the run's own end says that.
 */
export const APPROXIMATE_PERCENT_CAP = 99;

/**
 * A run's progress, with the unknown case kept unknown unless an earlier run
 * gives an approximate total.
 *
 * `totalPlanned` is null until the catalog walk has finished counting, which is
 * several minutes into an eighteen minute run, and a DEZA walk never knows it
 * while it runs (backend plan 0267). The percentage stays null then, and the
 * screen says how many rather than how far.
 *
 * `earlier` is what the latest completed run of the same preset, or else of
 * the same chain and mode, processed ({@link earlierTotal}). It is used only
 * while the run's own total is unknown, so a known total is never replaced;
 * never while the run has processed nothing, because "0 of about 2,361" says
 * nothing a bare count does not; and never when the run has already passed
 * it, because "900 of about 824" would print a whole smaller than its part.
 * The screen then says how many, as it does with no earlier run.
 *
 * Nor is it used for a run whose adapter's walk total says nothing about the
 * next walk (owner decision 127b, {@link hasComparableWalkTotal}): a DEZA walk
 * reads "4,000 processed" and never "of about 15,115", whatever number is
 * handed in.
 *
 * A run that stopped short (aborted, failed or stale) keeps the estimate,
 * worded in the past, and gets no bar (owner decision 97b): "824 processed of
 * about 2,361" says how far a stopped walk got, and a bar on it would read as
 * progress. A completed run gets no estimate at all (owner decision 111c): it
 * did the whole walk, and "2,100 processed of about 2,361" would read as a run
 * that fell short. It reads "2,100 processed", as it did before the estimate.
 *
 * The percentage stops at 100. A Carrefour catalog, DIA catalog or DIA store
 * discovery run from before backend plan 0217 counted two units in `processed`
 * and keeps a count above `totalPlanned`, which no migration can correct
 * exactly. Its bar is drawn full and no more.
 */
export function runProgress(
  run: HarvestRun,
  earlier: number | null = null
): RunProgress {
  const total = run.totalPlanned;
  const usable = total !== null && total > 0;

  if (usable) {
    return {
      processed: run.processed,
      total,
      percent: Math.min(100, Math.round((run.processed / total) * 100)),
    };
  }

  const about =
    total === null &&
    run.status !== 'COMPLETED' &&
    hasComparableWalkTotal(run) &&
    run.processed > 0 &&
    earlier !== null &&
    earlier > 0 &&
    earlier >= run.processed
      ? earlier
      : null;

  if (about === null) {
    return { processed: run.processed, total, percent: null };
  }

  const ended = isTerminalRun(run);
  return {
    processed: run.processed,
    total,
    percent: ended
      ? null
      : Math.min(
          APPROXIMATE_PERCENT_CAP,
          Math.round((run.processed / about) * 100)
        ),
    about,
    ended,
  };
}

/** The words of a run's progress line: a translation key and its values. */
export interface RunProgressLine {
  readonly key:
    | 'harvest.run.progress.of'
    | 'harvest.run.progress.processed'
    | 'harvest.run.progress.ofAbout'
    | 'harvest.run.progress.ofAboutEnded';
  /**
   * The values. Raw numbers on the lines with no estimate, exactly as they
   * were drawn before the estimate existed (owner decision 99b); strings
   * grouped for the reader's language on the estimate line only.
   */
  readonly args: {
    readonly processed: number | string;
    readonly total?: number | string | null;
  };
  /** Whether this is the estimate line, which must say it is approximate. */
  readonly approximate: boolean;
}

/**
 * "N of T", "N processed", or the estimate line, as the header strip and the
 * progress panel draw it. One function for both, so the two cannot word one
 * run two ways.
 *
 * Only the estimate line is formatted with the locale's grouping ("824 of
 * about 2,361"). The two lines that existed before keep their raw numbers
 * ("1907 of 4383"), the way every other count on the run page is drawn
 * (owner decision 99b).
 */
export function runProgressLine(
  progress: RunProgress,
  locale: string
): RunProgressLine {
  const about = progress.about ?? null;
  if (progress.total !== null || about === null) {
    return progress.total !== null
      ? {
          key: 'harvest.run.progress.of',
          args: { processed: progress.processed, total: progress.total },
          approximate: false,
        }
      : {
          key: 'harvest.run.progress.processed',
          args: { processed: progress.processed },
          approximate: false,
        };
  }
  const format = new Intl.NumberFormat(locale);
  return {
    key: progress.ended
      ? 'harvest.run.progress.ofAboutEnded'
      : 'harvest.run.progress.ofAbout',
    args: {
      processed: format.format(progress.processed),
      total: format.format(about),
    },
    approximate: true,
  };
}

/**
 * Whether a run read less than its chain's whole walk, by its own request
 * (owner decision 112b): a store discovery of two postal codes, a catalog walk
 * of named scopes, a detail backfill. The rule is the contracts' own
 * `isNarrowedRun`, called and not restated, which also holds that a request
 * the run cannot state (`input` null, or absent from an older gateway) counts
 * as narrowed: the direction that draws no estimate rather than a wrong one.
 */
export function isNarrowedRun(run: HarvestRun): boolean {
  return isNarrowedRunByContract(run);
}

/**
 * Whether the count of one finished walk of this run's adapter says about how
 * big the next walk is, so that an earlier total may be drawn as an estimate
 * (owner decision 127b). Read off the adapter the run itself walked with
 * (`adapterKey`), through the generated capability table, as `readsTheChain`
 * reads it.
 *
 * False for `deza-web`, whose capped queries can count different totals for
 * one assortment, and false for an adapter this build does not know. False as
 * well for a run that names no adapter: a file import, and a run stored
 * before the harvester recorded one for every walk. Both also carry no
 * `configFingerprint`, so owner decision 130b gives them no reference
 * whatever this answers. A store discovery OpenStreetMap walks, typed, from a
 * preset or from the postal code queue, names `osm-places` (owner decision
 * 137b), whose walk totals compare.
 */
export function hasComparableWalkTotal(run: HarvestRun): boolean {
  const adapterKey = run.adapterKey ?? null;
  if (adapterKey === null) {
    return false;
  }
  const table: Readonly<
    Record<string, { readonly comparableWalkTotal: boolean } | undefined>
  > = HarvestAdapterCapabilityTable;
  return table[adapterKey]?.comparableWalkTotal === true;
}

/**
 * Whether an earlier run walked under the same configuration as this one, so
 * that its total may stand for this run's (owner decision 130b). The rule is
 * the contracts' own `walkedUnderSameConfig`, called and not restated: true
 * only when both runs carry the same fingerprint, so a run stored before the
 * fingerprint existed is no reference and has none.
 */
export function walkedUnderSameConfigAs(
  run: HarvestRun,
  reference: HarvestRun
): boolean {
  return walkedUnderSameConfig(
    run.configFingerprint,
    reference.configFingerprint
  );
}

/**
 * Whether a run's progress is drawn against nothing it knows, so that another
 * run is worth reading for an approximate total. A run that has processed
 * nothing shows no estimate, so it is not read for one either; nor is a
 * completed run, which shows its own count and never an estimate (owner
 * decision 111c); nor is a run with nothing to compare with: no preset, and
 * no chain, or a chain whose earlier runs say nothing about it because its own
 * request is narrowed (owner decision 112b).
 *
 * Nor is a run whose adapter's walk total cannot be compared between runs
 * (owner decision 127b, {@link hasComparableWalkTotal}), and nor is a run with
 * no `configFingerprint`, which no earlier run can match (owner decision 130b,
 * {@link walkedUnderSameConfigAs}). Both make no read at all, as a narrowed
 * run with no preset makes none.
 */
export function wantsEarlierTotal(run: HarvestRun | null): run is HarvestRun {
  return (
    run !== null &&
    run.status !== 'COMPLETED' &&
    run.totalPlanned === null &&
    run.processed > 0 &&
    hasComparableWalkTotal(run) &&
    (run.configFingerprint ?? '') !== '' &&
    ((run.presetId ?? '') !== '' ||
      ((run.supermarketId ?? '') !== '' && !isNarrowedRun(run)))
  );
}

/**
 * What an earlier run says the whole is: what it processed, when it completed
 * and still stands. A failed, aborted or stale run stopped short, and a
 * reverted run's writes were taken back, so neither says how big the walk is.
 * Null for those and for a run that processed nothing.
 */
export function earlierTotal(
  run: HarvestRun | null | undefined
): number | null {
  return run !== null &&
    run !== undefined &&
    run.status === 'COMPLETED' &&
    run.revertedAt === null &&
    run.processed > 0
    ? run.processed
    : null;
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
