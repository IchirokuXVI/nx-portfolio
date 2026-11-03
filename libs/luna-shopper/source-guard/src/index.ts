/**
 * The per run refusal guard (plan 0215): one object per run, shared by every
 * worker and every client of the run, that turns a run of refusals into a
 * pause, one probe at a time, and a stop.
 *
 * Framework free by hard constraint, and stricter than the adapter libraries:
 * it imports nothing at all, not even another library of the workspace. Each
 * adapter library imports it and exports its own policy beside its client.
 */

export type { RefusalPolicy } from './lib/refusal-policy';
export {
  ISOLATED_URLS_NAMED,
  SourceBlockedError,
  SourceGuard,
  describeTrip,
  minutes,
} from './lib/source-guard';
export type {
  SourceGuardOptions,
  SourceGuardSummary,
  SourceStop,
  SourceTrip,
} from './lib/source-guard';
