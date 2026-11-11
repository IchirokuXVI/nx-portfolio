import { HarvestAdapterCapabilityTable } from '../wire/wire-types';
import type { HarvestRunMode } from './harvest-run';

/**
 * What a probe of a chain's storefront said, as the start of a run reads it
 * (admin plan 0069, section 4; backend plan 0219, section 5).
 *
 * **This app's own enum**, as rule D4 asks, rather than a re-export of
 * `Wire.EnumsSourceProbeStatus`. A status the backend adds later reaches this
 * app as an unknown string, and {@link toProbeStatus} answers null for it.
 */
export type ProbeStatus =
  | 'RUNNING'
  | 'PASSED'
  | 'SHAPE_CHANGED'
  | 'BLOCKED'
  | 'UNREACHABLE'
  | 'ERROR'
  | 'ABORTED';

/** The four verdicts that are not a pass, which the notice names. */
export type RedProbeStatus = Exclude<
  ProbeStatus,
  'RUNNING' | 'PASSED' | 'ABORTED'
>;

const PROBE_STATUSES: readonly ProbeStatus[] = [
  'RUNNING',
  'PASSED',
  'SHAPE_CHANGED',
  'BLOCKED',
  'UNREACHABLE',
  'ERROR',
  'ABORTED',
];

/** A probe status off the wire, or null when it is not one this app knows. */
export function toProbeStatus(value: unknown): ProbeStatus | null {
  return typeof value === 'string' &&
    (PROBE_STATUSES as readonly string[]).includes(value)
    ? (value as ProbeStatus)
    : null;
}

/**
 * The newest finished probe of a chain that did not pass.
 *
 * `error` is the probe's one sentence, which names the step and its first
 * problem, with no closing period so the notice can put the sentence inside
 * its own. Null when the probe sent none.
 */
export interface ProbeVerdict {
  readonly id: string;
  readonly status: RedProbeStatus;
  readonly startedAt: string;
  readonly error: string | null;
}

/** One row of the probe list, read as `unknown` (rule D4). */
interface ProbeRow {
  readonly id: string;
  readonly status: ProbeStatus | null;
  readonly startedAt: string;
  readonly error: string | null;
}

function toProbeRow(value: unknown): ProbeRow | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = row['id'];
  const startedAt = row['startedAt'];
  if (typeof id !== 'string' || typeof startedAt !== 'string') {
    return null;
  }
  const error = row['error'];
  const sentence =
    typeof error === 'string' ? error.trim().replace(/\.+$/, '') : '';
  return {
    id,
    status: toProbeStatus(row['status']),
    startedAt,
    error: sentence === '' ? null : sentence,
  };
}

/**
 * The red probe a start warns about, from a page of the chain's probes,
 * newest first (admin plan 0069, constraints).
 *
 * The first row that is neither `RUNNING` nor `ABORTED` decides: a probe in
 * flight has no verdict yet, and an abort is a deploy, not a fault of the
 * chain. That row answers when it did not pass, and a pass answers null.
 *
 * A row this app cannot read, or one with a status it does not know, ends the
 * search with null. A warning about a probe the app cannot name would be a
 * guess, and the start is never gated on it anyway.
 */
export function redProbe(page: unknown): ProbeVerdict | null {
  const items =
    typeof page === 'object' && page !== null
      ? (page as Record<string, unknown>)['items']
      : undefined;
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    const row = toProbeRow(item);
    if (row === null || row.status === null) {
      return null;
    }
    if (row.status === 'RUNNING' || row.status === 'ABORTED') {
      continue;
    }
    if (row.status === 'PASSED') {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      startedAt: row.startedAt,
      error: row.error,
    };
  }
  return null;
}

/**
 * Whether a run of this mode reads the chain's storefront (backend plan 0247,
 * section 2, step 3).
 *
 * A catalog discovery always does. A store discovery does when the adapter
 * publishes its own shop list, and is a radius over OpenStreetMap otherwise.
 * A file import reads a document and no storefront.
 *
 * The adapters come from the capability table the gateway publishes, which is
 * `adapterCapabilities` of the contracts written into the OpenAPI document
 * (backend plan 0103, section 4.1). The admin cannot import the contracts
 * barrel into an Angular build, and the generated table is the same answer
 * with a spec of its own that fails when it goes stale. For a store discovery,
 * an adapter this build does not know answers no, as every other reader of the
 * table does. A chain with no probe gets no notice whatever this answers.
 */
export function readsTheChain(
  mode: HarvestRunMode,
  adapterKey: string
): boolean {
  if (mode === 'CATALOG_DISCOVERY') {
    return true;
  }
  const table: Readonly<
    Record<string, { readonly listsItsOwnStores: boolean } | undefined>
  > = HarvestAdapterCapabilityTable;
  return (
    mode === 'STORE_DISCOVERY' && table[adapterKey]?.listsItsOwnStores === true
  );
}
