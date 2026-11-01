import { CARREFOUR_REFUSAL_POLICY } from '@portfolio/luna-shopper/carrefour';
import {
  HarvestRunMode,
  type AdapterKey,
} from '@portfolio/luna-shopper/contracts';
import { DEZA_REFUSAL_POLICY } from '@portfolio/luna-shopper/deza';
import { DIA_REFUSAL_POLICY } from '@portfolio/luna-shopper/dia';
import { ELJAMON_REFUSAL_POLICY } from '@portfolio/luna-shopper/eljamon';
import { LIDL_REFUSAL_POLICY } from '@portfolio/luna-shopper/lidl';
import { MERCADONA_REFUSAL_POLICY } from '@portfolio/luna-shopper/mercadona';
import {
  describeTrip,
  minutes,
  type RefusalPolicy,
  type SourceStop,
  type SourceTrip,
} from '@portfolio/luna-shopper/source-guard';

/**
 * The refusal policy of each storefront adapter (plan 0215, section 3).
 *
 * The numbers are each adapter library's own constant, because they are a
 * fact about that storefront. This map only chooses between them. An adapter
 * it does not name gets no guard, and its run behaves as it did before the
 * plan: OpenStreetMap, which a radius search asks a few times, and a file
 * import, which fetches nothing.
 *
 * No environment variable and no column: a change for one chain is one line
 * in that chain's library.
 */
const POLICY_BY_ADAPTER: Partial<Record<AdapterKey, Readonly<RefusalPolicy>>> =
  {
    'mercadona-api': MERCADONA_REFUSAL_POLICY,
    'lidl-api': LIDL_REFUSAL_POLICY,
    'eljamon-web': ELJAMON_REFUSAL_POLICY,
    'deza-web': DEZA_REFUSAL_POLICY,
    'dia-api': DIA_REFUSAL_POLICY,
    'carrefour-web': CARREFOUR_REFUSAL_POLICY,
  };

/** The policy of a run of this adapter, or null for a run with no guard. */
export function refusalPolicyOf(
  adapterKey: AdapterKey | undefined,
  mode: HarvestRunMode
): Readonly<RefusalPolicy> | null {
  if (mode === HarvestRunMode.FILE_IMPORT || !adapterKey) {
    return null;
  }
  return POLICY_BY_ADAPTER[adapterKey] ?? null;
}

/** "14:03 UTC", the time a sentence names. */
function clock(at: number): string {
  return `${new Date(at).toISOString().slice(11, 16)} UTC`;
}

/** The whole minutes of a pause, for "a 10 minute pause". */
function minuteCount(ms: number): number {
  return Math.round(ms / 60_000);
}

/** The stage label while a run pauses (plan 0215, section 5). */
export function pausedLabel(trip: SourceTrip): string {
  return (
    `The chain refused ${describeTrip(trip)}. Waiting ` +
    `${minutes(trip.pauseMs ?? 0)} before trying one more.`
  );
}

/** The `SOURCE_PAUSED` warning. */
export function pausedWarning(trip: SourceTrip): string {
  return (
    `The chain refused ${describeTrip(trip)} at ${clock(trip.at)}, the last ` +
    `with ${trip.status} for ${trip.url}. The run paused for ` +
    `${minutes(trip.pauseMs ?? 0)} and sent nothing while it lasted.`
  );
}

/** The `SOURCE_RESUMED` warning. */
export function resumedWarning(at: number): string {
  return (
    `A probe after the pause was answered at ${clock(at)}, so the run goes ` +
    'on at its own rate.'
  );
}

/**
 * The `error` of a run the guard stopped (plan 0215, section 6.2), for
 * example: "Stopped: the chain refused 5 requests in a row at 14:03 UTC and
 * still refused 3 probes after a 10 minute pause. The 2,140 products read
 * before are kept."
 *
 * `kept` is the count of products the run wrote, null when the run reported
 * none to count.
 */
export function stopSentence(
  stop: SourceStop,
  pauses: boolean,
  kept: number | null
): string {
  const trip = stop.trip;
  let why: string;
  if (stop.cause === 'probes') {
    why =
      `the chain refused ${describeTrip(trip)} at ${clock(trip.at)} and ` +
      `still refused ${stop.probesRefused} probe(s) after a ` +
      `${minuteCount(stop.pausedMs ?? 0)} minute pause`;
  } else if (stop.pausedMs !== null) {
    why =
      `the chain refused ${describeTrip(trip)} at ${clock(trip.at)}, after ` +
      `a ${minuteCount(stop.pausedMs)} minute pause earlier in the run`;
  } else if (!pauses) {
    why =
      `the chain refused ${describeTrip(trip)} at ${clock(trip.at)}, and ` +
      'the run does not pause for this chain';
  } else {
    why = `the chain refused ${describeTrip(trip)} at ${clock(trip.at)}`;
  }
  const keptSentence =
    kept === null
      ? 'Everything read before the stop is kept.'
      : `The ${kept.toLocaleString('en-US')} product(s) read before are kept.`;
  return `Stopped: ${why}. ${keptSentence}`;
}
