import type { HarvestRunWarning } from '@portfolio/luna-shopper/contracts';
import type { HarvestRun } from '../entities';
import { TokenBucket } from '../runner/token-bucket';
import type { HarvestRunStore, RunCounters } from './harvest-run.store';

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

  /** What the source clients await before every request. */
  acquire = (): Promise<void> => this.bucket.acquire();

  async setStage(stage: string, label: string): Promise<void> {
    await this.flush();
    await this.store.setStage(this.runId, stage, label);
  }

  async setTotalPlanned(total: number): Promise<void> {
    await this.store.setTotalPlanned(this.runId, total);
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
