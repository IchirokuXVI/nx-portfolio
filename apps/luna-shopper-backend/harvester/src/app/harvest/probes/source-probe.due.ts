import { SourceProbeStatus } from '@portfolio/luna-shopper/contracts';

/**
 * When the worker probes a source by itself (plan 0219, section 7, as the
 * owner decided it on 2026-11-06). One pure function, so the cadence and the
 * retry are one place.
 *
 * The other conditions of a due source (the row is on, the adapter has a
 * probe, no run of the chain and no probe of the source in flight) are read
 * by the claim in the statement that locks the row.
 */

/**
 * `supermarket_sources.config.probeIntervalHours`: an integer from 0 to a
 * year, default 24. 0 means the worker never probes the chain by itself; a
 * manual start is unaffected. A value out of range or not an integer is
 * ignored and the default applies, as plan 0220 reads its thresholds.
 */
export const PROBE_INTERVAL_HOURS = {
  fallback: 24,
  min: 0,
  max: 8760,
} as const;

/** The default interval, in milliseconds. */
export const PROBE_INTERVAL_MS = PROBE_INTERVAL_HOURS.fallback * 3_600_000;

/** How long after an `UNREACHABLE` probe the next attempt is due. */
export const PROBE_RETRY_MS = 30 * 60_000;

/** The attempts of one `UNREACHABLE` series. The third is final. */
export const PROBE_MAX_ATTEMPTS = 3;

/** The newest probe of a source that is not `RUNNING`, as the due rule reads it. */
export interface NewestProbe {
  status: SourceProbeStatus;
  attempt: number;
  startedAt: Date;
}

/** The interval of one chain, in hours, from its source row's `config`. */
export function readProbeIntervalHours(
  config: Record<string, unknown> | null | undefined
): number {
  const value = config?.['probeIntervalHours'];
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PROBE_INTERVAL_HOURS.min &&
    value <= PROBE_INTERVAL_HOURS.max
    ? value
    : PROBE_INTERVAL_HOURS.fallback;
}

/**
 * The attempt the next scheduled probe of a source carries when it is due at
 * `now`, or null when it is not due.
 *
 * - A chain whose interval is 0 is never due.
 * - After an `UNREACHABLE` probe whose attempt is below 3, the source is due
 *   once `PROBE_RETRY_MS` has passed since that probe started, whatever the
 *   interval, and the next probe is the following attempt.
 * - Otherwise it is due when its newest probe started more than the interval
 *   ago, or it has none, and the next probe is attempt 1. An `UNREACHABLE`
 *   attempt 3 is final, so the interval counts from it.
 */
export function probeDueAttempt(
  config: Record<string, unknown> | null | undefined,
  newest: NewestProbe | null,
  now: Date
): number | null {
  const hours = readProbeIntervalHours(config);
  if (hours === 0) {
    return null;
  }
  if (newest === null) {
    return 1;
  }
  const elapsed = now.getTime() - new Date(newest.startedAt).getTime();
  if (
    newest.status === SourceProbeStatus.UNREACHABLE &&
    newest.attempt < PROBE_MAX_ATTEMPTS
  ) {
    return elapsed >= PROBE_RETRY_MS ? newest.attempt + 1 : null;
  }
  return elapsed > hours * 3_600_000 ? 1 : null;
}
