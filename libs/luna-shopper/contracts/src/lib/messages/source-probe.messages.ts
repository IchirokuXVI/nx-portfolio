import type { HarvestRunTrigger } from '../enums/harvest.enums';
import type { SourceProbeStatus } from '../enums/source-probe.enums';
import type { PageQuery, Paginated } from '../pagination';
import type { AdminCredential } from './admin-auth.messages';
import type { AdapterKey } from './harvest.messages';

/**
 * A probe per chain checks the storefront shape (plan 0219).
 *
 * Two to five requests a day per chain, made from the harvester pod, that run
 * the real client and the real parsers of the adapter library and say whether
 * what they read still looks like what a walk depends on. Each probe is a row
 * of `source_probes`. It writes nothing else.
 */
export const SOURCE_PROBE_PATTERNS = {
  /** Start a probe by hand. Answers the `RUNNING` row before the probe ends. */
  start: 'sourceProbe.start',
  /** The probes of one chain, newest first. */
  list: 'sourceProbe.list',
  /** One probe, which a client polls until it is not `RUNNING`. */
  get: 'sourceProbe.get',
} as const;

/** One read inside a probe (plan 0219, section 3.1). */
export interface SourceProbeStepView {
  /** 'warehouse' | 'categories' | 'listing' | 'product' | 'shops' */
  name: string;
  /** The URL the step read, or null when the client hides it. */
  url: string | null;
  ok: boolean;
  /** The status of a refused or failed response, null when none. */
  httpStatus: number | null;
  /** The message of an exception the step met, null when none. */
  error: string | null;
  /** One sentence per thing the parser read wrong. Empty when ok. */
  problems: string[];
  /** A few parsed values, for a person to read: a count, a name, a price in cents. */
  sample: Record<string, string | number | boolean | null>;
  durationMs: number;
}

/** What the `probe` function of an adapter library answers. */
export interface SourceProbeResult {
  steps: SourceProbeStepView[];
  /** Requests made, or pages loaded for Carrefour. */
  requests: number;
  /**
   * The exception that stopped the probe, or undefined when none did.
   *
   * Never stored and never sent. The harvester reads it to tell a network
   * error, a timeout, a refusal the guard stopped and a broken browser apart
   * (section 5), which the message alone cannot do reliably.
   */
  failure?: unknown;
}

/** One probe, as the back office reads it (plan 0219, section 8). */
export interface SourceProbeView {
  id: string;
  sourceId: string;
  supermarketId: string;
  adapterKey: AdapterKey;
  /** `MANUAL` or `SCHEDULED`, never `SYSTEM`. */
  trigger: HarvestRunTrigger;
  status: SourceProbeStatus;
  /** The newest finished probe of the source before this one that is not `ABORTED`. */
  previousStatus: SourceProbeStatus | null;
  /** True when `status` differs from `previousStatus` and that is not null. */
  changed: boolean;
  /**
   * The attempt of one `UNREACHABLE` series, 1 to 3. A manual probe and one
   * the interval made due are 1, and each retry 30 minutes after an
   * `UNREACHABLE` is the next. The third is final.
   */
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  requests: number;
  steps: SourceProbeStepView[];
  /** One sentence naming the step and its first problem, null when it passed. */
  error: string | null;
  requestedByUserId: string | null;
  /**
   * The schedule whose slot ran this probe as its gate, null for a daily or
   * manual probe (plan 0247). A gate probe and a daily probe both carry
   * trigger `SCHEDULED`, and this tells them apart.
   */
  scheduleId: string | null;
}

/** The newest probe of a source that is not `ABORTED`, on its source view. */
export interface SourceProbeSummary {
  id: string;
  status: SourceProbeStatus;
  startedAt: string;
  finishedAt: string | null;
  changed: boolean;
}

export type SourceProbePage = Paginated<SourceProbeView>;

export interface StartSourceProbeRequest extends AdminCredential {
  supermarketId: string;
}

/** Newest first. `limit` is 1 to 100, and 20 when absent. */
export interface ListSourceProbesRequest extends PageQuery, AdminCredential {
  supermarketId: string;
}

export interface SourceProbeIdRequest extends AdminCredential {
  probeId: string;
}
