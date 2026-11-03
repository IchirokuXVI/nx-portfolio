import {
  HarvestWarningCode,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import {
  SourceGuard,
  type RefusalPolicy,
  type SourceStop,
} from '@portfolio/luna-shopper/source-guard';
import type { HarvestRun } from '../entities';
import { TokenBucket } from '../runner/token-bucket';
import type { HarvestRunStore, RunCounters } from './harvest-run.store';
import { pausedLabel, pausedWarning, resumedWarning } from './refusal-policy';

/**
 * What a runner is handed: the run row, the abort signal, the shared rate limiter
 * and one method for reporting progress (plan 0038, section 6.6).
 *
 * Progress is written **every batch and at least every 10 seconds**, and the
 * throttle lives here rather than in each runner so the three cannot disagree
 * about it. Counters accumulate in memory between flushes, which is why
 * {@link flush} exists and why the finalizer always calls it: an aborted run must
 * still record what it did before it stopped.
 */
const HEARTBEAT_INTERVAL_MS = 10_000;

export class RunContext {
  private pending: Required<RunCounters> = emptyCounters();
  private pendingWarnings: HarvestRunWarning[] = [];
  private lastFlushAt = 0;

  constructor(
    readonly run: HarvestRun,
    readonly signal: AbortSignal,
    readonly bucket: TokenBucket,
    private readonly store: HarvestRunStore,
    private readonly now: () => number = () => Date.now()
  ) {}

  get runId(): string {
    return this.run.id;
  }

  /**
   * The run's one refusal guard (plan 0215, section 5), when its adapter has
   * a policy. Each runner passes it to the clients it builds, beside
   * `acquire`, so every client of the run reports to the same count.
   */
  guard: SourceGuard | undefined = undefined;

  /** The stage and label a runner last set, put back when a pause ends. */
  private lastStage: { stage: string; label: string } | null = null;

  /**
   * What the source clients await before every request: the bucket, and then
   * the guard, which holds every worker here while a pause lasts.
   *
   * The guard comes last on purpose. A worker can wait in the bucket for a
   * while, and a pause that begins during that wait must hold it too: with the
   * guard first, it would have been admitted before the trip and would send
   * one request into the pause.
   */
  acquire = async (): Promise<void> => {
    await this.bucket.acquire();
    await this.guard?.admit(this.signal);
  };

  async setStage(stage: string, label: string): Promise<void> {
    this.lastStage = { stage, label };
    await this.writeStage(stage, label);
  }

  private async writeStage(stage: string, label: string): Promise<void> {
    await this.flush();
    await this.store.setStage(this.runId, stage, label);
  }

  async setTotalPlanned(total: number): Promise<void> {
    await this.store.setTotalPlanned(this.runId, total);
  }

  /**
   * What this run has to say about itself beyond its counters (plan 0085,
   * section 3): sections a budget could not finish, availability a person had
   * typed and the run declined to overwrite.
   *
   * Not an error and not a failure. It is written once, near the end, and read
   * once, by a person looking at a finished run.
   */
  async setReport(report: Record<string, unknown>): Promise<void> {
    await this.store.setReport(this.runId, report);
  }

  /**
   * Record work. Cheap: it accumulates and writes at most once per interval, so a
   * 4,232 item run does tens of updates rather than thousands.
   */
  async report(counters: RunCounters): Promise<void> {
    for (const [key, value] of Object.entries(counters)) {
      if (value) {
        this.pending[key as keyof RunCounters] += value;
      }
    }
    if (this.now() - this.lastFlushAt >= HEARTBEAT_INTERVAL_MS) {
      await this.flush();
    }
  }

  /**
   * Say the run is alive without counting anything.
   *
   * An enumerate stage can fetch for many minutes before it has a counter to
   * add, and a heartbeat that only moves with the counters reads as a stopped
   * run to the stale reaper, which then marks the run STALE and releases its
   * lock while the crawl is still working. Throttled exactly like
   * {@link report}, so a call per row costs one write per interval.
   */
  async heartbeat(): Promise<void> {
    if (this.now() - this.lastFlushAt >= HEARTBEAT_INTERVAL_MS) {
      await this.flush();
    }
  }

  /**
   * Record a decision that was not a write (plan 0081, section 7).
   *
   * Accumulated beside the counters and written by the same flush, so a run that
   * skipped 40 offers does one append rather than 40. A warning does **not**
   * count as skipped by itself: a queued offer and a dropped one are both
   * warnings, and only the runner knows which counter each belongs to.
   */
  warn(warning: HarvestRunWarning): void {
    this.pendingWarnings.push(warning);
  }

  /** Write whatever has accumulated. Always called before a run finalizes. */
  async flush(): Promise<void> {
    this.lastFlushAt = this.now();
    const counters = this.pending;
    const warnings = this.pendingWarnings;
    this.pending = emptyCounters();
    this.pendingWarnings = [];
    if (warnings.length > 0) {
      await this.store.addWarnings(this.runId, warnings);
    }
    if (Object.values(counters).every((value) => value === 0)) {
      if (warnings.length === 0) {
        await this.store.touchHeartbeat(this.runId);
      }
      return;
    }
    await this.store.addCounters(this.runId, counters);
  }

  /**
   * Build the run's one refusal guard and keep it as {@link guard} (plan
   * 0215, section 5). One per run, never one per client.
   *
   * - A trip that pauses writes a `SOURCE_PAUSED` warning and the stage
   *   `PAUSED`. A trip that stops the run writes neither: its `error` says so.
   * - A resume writes `SOURCE_RESUMED` and puts back the stage it replaced.
   * - The pause keeps the heartbeat moving, so ten minutes of waiting never
   *   reach the stale reaper's fifteen.
   * - `onStop` is the executor's, which aborts the run.
   *
   * The writes are not awaited, because the guard calls back from inside a
   * client's request loop. Each one swallows its own failure: a lost stage
   * label costs a label and never the run.
   */
  guardWith(
    policy: RefusalPolicy,
    onStop: (stop: SourceStop) => void
  ): SourceGuard {
    const guard = new SourceGuard(policy, {
      now: this.now,
      signal: this.signal,
      onTrip: (trip) => {
        if (trip.pauseMs === null) {
          return;
        }
        this.warn(
          guardWarning(HarvestWarningCode.SOURCE_PAUSED, pausedWarning(trip))
        );
        void this.writeStage('PAUSED', pausedLabel(trip)).catch(
          () => undefined
        );
      },
      onResume: () => {
        this.warn(
          guardWarning(
            HarvestWarningCode.SOURCE_RESUMED,
            resumedWarning(this.now())
          )
        );
        const stage = this.lastStage;
        void (
          stage ? this.writeStage(stage.stage, stage.label) : this.flush()
        ).catch(() => undefined);
      },
      onWait: () => {
        void this.heartbeat().catch(() => undefined);
      },
      onStop,
    });
    this.guard = guard;
    return guard;
  }
}

/** A warning about the run itself, which names no offer, page or product. */
function guardWarning(
  code: HarvestWarningCode,
  message: string
): HarvestRunWarning {
  return { code, message, offerId: null, page: null, name: null };
}

function emptyCounters(): Required<RunCounters> {
  return {
    processed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    skipped: 0,
    failed: 0,
  };
}
