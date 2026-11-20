import type { RefusalPolicy } from './refusal-policy';

/**
 * One guard per run, shared by every worker and every client of the run
 * (plan 0215, sections 2 to 4).
 *
 * A 403 arrives with no label, so the guard does not guess from one answer.
 * It reads the answers of the whole run in the order they arrive, from any
 * worker and any client, and trips on either rule of its policy: refusals in a
 * row with no clearing answer between them, or too many refusals among the
 * last answers. A trip either pauses the run, waits out one cool down and then
 * lets one probe at a time through, or stops it.
 *
 * **What a client reports.** Every request that was admitted ends in exactly
 * one of three calls:
 *
 * - {@link SourceGuard.answered}: an answer that clears the count, a 2xx and a
 *   404 (and a 3xx where the client reads one).
 * - {@link SourceGuard.refused}: a refusal, a 403 or a 429 that outlived the
 *   client's own retries.
 * - {@link SourceGuard.inconclusive}: an answer that says nothing either way,
 *   a 5xx or a request with no answer, before the client retries it or gives
 *   up. It leaves the count as it was. During probing it hands the probe on,
 *   so a probe that met a 5xx cannot hold every other worker at the gate.
 *
 * A request still in flight when the run pauses may come back after the pause
 * has ended, and the guard then takes its answer for the probe's. That needs
 * a request that outlives a ten minute pause, and costs at most one probe.
 *
 * Framework free and dependency free: no Node module, no other library. The
 * clock and the sleep are options, so every spec drives it by hand.
 */

export interface SourceTrip {
  /** When, on the guard's clock. */
  at: number;
  /** Which rule tripped. */
  rule: 'consecutive' | 'window';
  /** The refusals the rule counted: in a row, or within the window. */
  refusals: number;
  /** The size of the window for the window rule, null for the other. */
  of: number | null;
  status: number;
  url: string;
  /** How long the run now pauses, or null when this trip stops it. */
  pauseMs: number | null;
}

export interface SourceStop {
  /** When, on the guard's clock. */
  at: number;
  /**
   * `trip` when a trip found no pause left, `probes` when the probes after a
   * pause were refused.
   */
  cause: 'trip' | 'probes';
  /** The trip that led to the stop: the one that paused, or the last one. */
  trip: SourceTrip;
  probesRefused: number;
  /** The pause the run had before it stopped, null when it had none. */
  pausedMs: number | null;
  /** The answer that stopped the run. */
  status: number;
  url: string;
}

/** What the run's report states about its refusals (plan 0215, section 6.3). */
export interface SourceGuardSummary {
  /** Refusals that tripped nothing, each the cost of one item. */
  isolated: number;
  /** The first {@link ISOLATED_URLS_NAMED} of them. */
  isolatedUrls: string[];
  paused: {
    at: string;
    rule: SourceTrip['rule'];
    /** The refusals in a row when the guard tripped. */
    consecutive: number;
    /** The refusals the tripping rule counted. */
    refusals: number;
    resumedAt: string | null;
  } | null;
  probesRefused: number;
  stoppedAt: string | null;
  lastStatus: number | null;
  lastUrl: string | null;
}

export interface SourceGuardOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * The run's signal. An abort ends the timer of a pause, so a finished run
   * leaves nothing ticking. Each `admit` still takes its own signal.
   */
  signal?: AbortSignal;
  /**
   * Called on a trip, on a resume and on a stop. The harvester writes the
   * stage, a warning and the abort from these.
   */
  onTrip?: (trip: SourceTrip) => void;
  onResume?: () => void;
  onStop?: (stop: SourceStop) => void;
  /** Called about every 30 s while a pause lasts, so the run keeps its heartbeat. */
  onWait?: () => void;
}

/** How many isolated refusals the summary names by URL. */
export const ISOLATED_URLS_NAMED = 50;

/** How often a pause calls `onWait`. The stale reaper allows 15 minutes. */
const WAIT_TICK_MS = 30_000;

/**
 * Thrown by the refusal that stops a run, and by every waiting and every later
 * `admit` of that run. Nothing is sent after it.
 */
export class SourceBlockedError extends Error {
  constructor(readonly stop: SourceStop) {
    super(describeStop(stop));
    this.name = 'SourceBlockedError';
  }
}

type State = 'open' | 'paused' | 'probing' | 'stopped';

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

/**
 * A timer that an abort of `signal` ends early and clears, so a run that was
 * aborted during a pause leaves no timer behind it.
 */
const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

export class SourceGuard {
  private state: State = 'open';
  /** The URLs of the refusals in a row that nothing has decided on yet. */
  private streak: string[] = [];
  /** The last answers for the window rule, true for a refusal. */
  private recent: boolean[] = [];
  private coolDownsLeft: number;
  private probeInFlight = false;
  private probesRefused = 0;
  private readonly waiters: Waiter[] = [];
  private isolated = 0;
  private readonly isolatedUrls: string[] = [];
  private pauseTrip: SourceTrip | null = null;
  private resumedAt: number | null = null;
  private pausedStreak = 0;
  private lastStatus: number | null = null;
  private lastUrl: string | null = null;
  private stopped: SourceStop | null = null;
  private stopError: SourceBlockedError | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly policy: RefusalPolicy,
    private readonly options: SourceGuardOptions = {}
  ) {
    this.coolDownsLeft = policy.coolDowns;
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ?? ((ms) => defaultSleep(ms, this.options.signal));
  }

  /** Null until the run stops. */
  get stop(): SourceStop | null {
    return this.stopped;
  }

  /**
   * The refusals in a row since the last clearing answer: how close the
   * consecutive rule is to tripping. Zero after a clearing answer, after a
   * trip and once the run stops.
   */
  get consecutiveRefusals(): number {
    return this.state === 'stopped' ? 0 : this.streak.length;
  }

  /**
   * Awaited before every request. Waits through a pause, lets one probe at a
   * time through after it, and rejects with {@link SourceBlockedError} once
   * the run is stopped. An abort of `signal` while it waits rejects with the
   * signal's reason.
   */
  admit(signal?: AbortSignal): Promise<void> {
    if (this.stopError) {
      return Promise.reject(this.stopError);
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.state === 'open') {
      return Promise.resolve();
    }
    if (this.state === 'probing' && !this.probeInFlight) {
      this.probeInFlight = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) {
          this.waiters.splice(at, 1);
        }
        reject(this.stopError ?? signal?.reason);
      };
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** A clearing answer (section 2): a 2xx, a 404, a 3xx the client reads. */
  answered(): void {
    if (this.state === 'stopped') {
      return;
    }
    if (this.state === 'probing' && this.probeInFlight) {
      this.resume();
      return;
    }
    this.commitStreak();
    this.remember(false);
  }

  /**
   * A refusal. Answers `'retry'` when the request is to be sent again once
   * `admit` lets it, `'fail'` when it is an isolated refusal. Throws
   * {@link SourceBlockedError} when this refusal stops the run.
   */
  refused(status: number, url: string): 'retry' | 'fail' {
    this.lastStatus = status;
    this.lastUrl = url;
    if (this.stopError) {
      throw this.stopError;
    }
    if (this.state === 'paused') {
      // Sent before the pause and back during it. Not counted: the pause is
      // already the answer to it.
      return 'retry';
    }
    if (this.state === 'probing') {
      if (!this.probeInFlight) {
        return 'retry';
      }
      this.probeInFlight = false;
      this.probesRefused += 1;
      if (this.probesRefused >= this.policy.probes) {
        this.halt('probes', this.pauseTrip as SourceTrip, status, url);
      }
      this.handProbeOn();
      return 'fail';
    }

    this.streak.push(url);
    this.remember(true);
    const trip = this.tripOf(status, url);
    if (!trip) {
      return 'fail';
    }
    const streak = this.streak.length;
    this.streak = [];
    if (this.coolDownsLeft > 0) {
      this.coolDownsLeft -= 1;
      trip.pauseMs = this.policy.coolDownMs;
      this.state = 'paused';
      this.pauseTrip = trip;
      this.pausedStreak = streak;
      this.options.onTrip?.(trip);
      void this.coolDown();
      return 'retry';
    }
    this.options.onTrip?.(trip);
    return this.halt('trip', trip, status, url);
  }

  /**
   * An answer that says nothing either way: a 5xx, or a request with no
   * answer. Called before the client retries it or gives up. It leaves the
   * count as it was, and during probing it hands the probe on.
   */
  inconclusive(): void {
    if (this.state === 'probing' && this.probeInFlight) {
      this.probeInFlight = false;
      this.handProbeOn();
    }
  }

  /** What the run's report states (section 6.3). */
  summary(): SourceGuardSummary {
    // A streak still open at the end tripped nothing, so it was isolated.
    const pending = this.state === 'open' ? this.streak : [];
    const urls = [...this.isolatedUrls, ...pending].slice(
      0,
      ISOLATED_URLS_NAMED
    );
    const trip = this.pauseTrip;
    return {
      isolated: this.isolated + pending.length,
      isolatedUrls: urls,
      paused: trip
        ? {
            at: iso(trip.at),
            rule: trip.rule,
            consecutive: this.pausedStreak,
            refusals: trip.refusals,
            resumedAt: this.resumedAt === null ? null : iso(this.resumedAt),
          }
        : null,
      probesRefused: this.probesRefused,
      stoppedAt: this.stopped ? iso(this.stopped.at) : null,
      lastStatus: this.lastStatus,
      lastUrl: this.lastUrl,
    };
  }

  private tripOf(status: number, url: string): SourceTrip | null {
    const base = { at: this.now(), status, url, pauseMs: null };
    if (this.streak.length >= this.policy.consecutive) {
      return {
        ...base,
        rule: 'consecutive',
        refusals: this.streak.length,
        of: null,
      };
    }
    const window = this.policy.window;
    if (window) {
      const refusals = this.recent.filter(Boolean).length;
      if (refusals >= window.refusals) {
        return { ...base, rule: 'window', refusals, of: window.size };
      }
    }
    return null;
  }

  private remember(refusal: boolean): void {
    const window = this.policy.window;
    if (!window) {
      return;
    }
    this.recent.push(refusal);
    if (this.recent.length > window.size) {
      this.recent.shift();
    }
  }

  /** The refusals in a row a clearing answer ended were isolated after all. */
  private commitStreak(): void {
    for (const url of this.streak) {
      this.isolated += 1;
      if (this.isolatedUrls.length < ISOLATED_URLS_NAMED) {
        this.isolatedUrls.push(url);
      }
    }
    this.streak = [];
  }

  private async coolDown(): Promise<void> {
    let left = this.policy.coolDownMs;
    try {
      while (left > 0) {
        const tick = Math.min(WAIT_TICK_MS, left);
        await this.sleep(tick);
        left -= tick;
        if (this.state !== 'paused' || this.options.signal?.aborted) {
          return;
        }
        this.options.onWait?.();
      }
    } catch {
      // A sleep that failed ends the pause early rather than holding the run
      // at the gate for ever.
    }
    if (this.state !== 'paused') {
      return;
    }
    this.state = 'probing';
    this.handProbeOn();
  }

  /** Let the next waiter through as the probe, when nothing is probing. */
  private handProbeOn(): void {
    if (this.state !== 'probing' || this.probeInFlight) {
      return;
    }
    const next = this.waiters.shift();
    if (next) {
      this.probeInFlight = true;
      next.resolve();
    }
  }

  private resume(): void {
    this.state = 'open';
    this.probeInFlight = false;
    this.streak = [];
    this.recent = [];
    this.resumedAt = this.now();
    this.options.onResume?.();
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve();
    }
  }

  private halt(
    cause: SourceStop['cause'],
    trip: SourceTrip,
    status: number,
    url: string
  ): never {
    this.state = 'stopped';
    this.probeInFlight = false;
    this.stopped = {
      at: this.now(),
      cause,
      trip,
      probesRefused: this.probesRefused,
      pausedMs: this.pauseTrip ? this.policy.coolDownMs : null,
      status,
      url,
    };
    const error = new SourceBlockedError(this.stopped);
    this.stopError = error;
    // Rejected before `onStop` aborts the run, so a waiter learns the stop and
    // not only the abort that comes with it.
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
    this.options.onStop?.(this.stopped);
    throw error;
  }
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

/** The trip in words: "5 requests in a row", "20 of the last 50 requests". */
export function describeTrip(trip: SourceTrip): string {
  return trip.rule === 'consecutive'
    ? `${trip.refusals} requests in a row`
    : `${trip.refusals} of the last ${trip.of} requests`;
}

function describeStop(stop: SourceStop): string {
  const refused = `The chain refused ${describeTrip(stop.trip)}`;
  const last = `the last with ${stop.status} for ${stop.url}`;
  if (stop.cause === 'probes') {
    return (
      `${refused}, and still refused ${stop.probesRefused} probe(s) after a ` +
      `pause of ${minutes(stop.pausedMs ?? 0)}, ${last}. Nothing more is sent.`
    );
  }
  return `${refused}, ${last}. Nothing more is sent.`;
}

/** A pause in whole minutes, as a sentence says it. */
export function minutes(ms: number): string {
  const count = Math.round(ms / 60_000);
  return count === 1 ? '1 minute' : `${count} minutes`;
}
