/**
 * The times of the probe worker that other code must agree with (plan 0219,
 * section 7). A file of its own, with no Nest, so the pure gate of plan 0247
 * can derive its wait from the reaper and the two cannot drift.
 */

/** How often the worker looks for a due source. A constant, not a setting. */
export const PROBE_TICK_MS = 60_000;

/** A `RUNNING` probe this old belongs to a process that is gone. Twice the deadline. */
export const PROBE_REAP_AFTER_MS = 10 * 60_000;
