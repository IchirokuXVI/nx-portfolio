import { InjectionToken } from '@angular/core';

/**
 * How long the app waits, and how often it asks again, when the gateway stops
 * answering (plan 0008, section 8).
 *
 * **Durations, not fractions**, which is the one thing that separates this from
 * {@link ADMIN_SESSION_POLICY}. Those numbers are fractions because they are
 * relative to a token lifetime the server chooses. None of these is relative to
 * anything the server says: how long a person tolerates a spinner does not scale
 * with a token lifetime.
 */
export interface ReachabilityPolicy {
  /**
   * When a gateway request counts as a timeout.
   *
   * `fetch` has no timeout of its own, so without this a gateway that accepts a
   * connection and never answers hangs forever and nothing ever fails. Thirty
   * seconds is far beyond any request this app makes, and far below the point at
   * which an operator decides the page is broken and reloads it.
   */
  readonly requestTimeoutMs: number;
  /**
   * When a health probe counts as a failure.
   *
   * Much shorter than a request, because the probe is one unauthenticated read
   * of a liveness endpoint. A server that needs longer than this to say it is
   * alive is not a server the operator can work against.
   */
  readonly probeTimeoutMs: number;
  /** The wait between probes the app makes without being asked. */
  readonly retryIntervalMs: number;
  /**
   * How many probes the app makes on its own before it stops.
   *
   * The limit exists because the alternative is a tab left open overnight,
   * probing a dead host every two minutes until the laptop is closed. The retry
   * button never runs out; only this budget does.
   */
  readonly maxAutomaticAttempts: number;
}

/** Thirty seconds, five seconds, two minutes and ten. The plan's numbers. */
export const DEFAULT_REACHABILITY_POLICY: ReachabilityPolicy = {
  requestTimeoutMs: 30_000,
  probeTimeoutMs: 5_000,
  retryIntervalMs: 120_000,
  maxAutomaticAttempts: 10,
};

/**
 * The policy, as one overridable value.
 *
 * A token with a default rather than a constant three files import, so a spec
 * can drive twenty minutes of retries in a few milliseconds and the app can
 * change its mind in one line.
 */
export const ADMIN_REACHABILITY_POLICY = new InjectionToken<ReachabilityPolicy>(
  'ADMIN_REACHABILITY_POLICY',
  { factory: () => DEFAULT_REACHABILITY_POLICY }
);
