import type { RunEstimate } from '@portfolio/luna-shopper/contracts';

/**
 * About how long a run takes (plan 0206, section 8).
 *
 * Pure: the caller reads the durations, newest first, and this decides which
 * of them count. The duration of a run is `finishedAt - startedAt`, of runs
 * that ended `COMPLETED` and were not reverted.
 */

/** How many of the newest runs the median is taken over. */
export const ESTIMATE_SAMPLES = 5;

/**
 * The durations read on production on 2026-10-11, from completed runs. They go
 * out of date, and the owner accepted that: one completed run replaces one.
 */
export const DEFAULT_RUN_SECONDS: Readonly<Record<string, number>> = {
  'lidl-api': 60,
  'mercadona-api': 1200,
  'deza-web': 1500,
  'eljamon-web': 9600,
};

/** The default for an adapter the table does not name, and for no adapter. */
export const OTHER_RUN_SECONDS = 1800;

/** One finished run's duration. */
export interface RunSample {
  runId: string;
  seconds: number;
}

export interface EstimateHistory {
  /** Runs of the same preset, newest first, or null when there is no preset. */
  preset: readonly RunSample[] | null;
  /** Runs of the same source and mode, newest first, or null with no source. */
  source: readonly RunSample[] | null;
  /** The adapter of the chain, for the default. */
  adapterKey: string | null;
  /**
   * A run whose own duration must not count, which is the run the estimate
   * is drawn beside: a run's estimate never comes from the run itself.
   */
  excludeRunId?: string | null;
}

/**
 * The median of the newest five from the first basis that has at least one
 * run: the preset, then the source and mode, then the adapter's default.
 *
 * The median of five and not the mean of all, because a run gets faster when
 * the workers of a source are raised: the Mercadona walk went from twenty
 * minutes to ten between two runs.
 */
export function estimateRun(history: EstimateHistory): RunEstimate {
  for (const [basis, samples] of [
    ['PRESET', history.preset],
    ['SOURCE', history.source],
  ] as const) {
    const usable = (samples ?? [])
      .filter((sample) => sample.runId !== history.excludeRunId)
      .slice(0, ESTIMATE_SAMPLES)
      .map((sample) => sample.seconds);
    if (usable.length > 0) {
      return {
        seconds: Math.round(median(usable)),
        basis,
        samples: usable.length,
      };
    }
  }
  return {
    seconds:
      (history.adapterKey && DEFAULT_RUN_SECONDS[history.adapterKey]) ||
      OTHER_RUN_SECONDS,
    basis: 'DEFAULT',
    samples: 0,
  };
}

/** The middle value, or the mean of the two middle values of an even count. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
