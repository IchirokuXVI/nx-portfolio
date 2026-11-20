import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeError } from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../../config/app-config';
import { HARVEST_CLOCK, type HarvestClock } from '../schedule-slot';
import { PROBE_REAP_AFTER_MS, PROBE_TICK_MS } from './source-probe.constants';
import { PROBED_ADAPTER_KEYS } from './source-probe.runner';
import { SourceProbeService } from './source-probe.service';
import { SourceProbeStore } from './source-probe.store';

export { PROBE_REAP_AFTER_MS, PROBE_TICK_MS } from './source-probe.constants';
/** How long a probe is kept, the newest of each source always (section 4.2). */
export const PROBE_RETENTION_MS = 90 * 24 * 60 * 60_000;

/**
 * Starts the probe of each due chain where `HARVEST_SCHEDULER_ENABLED` is true
 * (plan 0219, section 7): once per `probeIntervalHours` of the chain, 24 by
 * default, and an `UNREACHABLE` probe again twice, 30 minutes apart (the
 * owner decided both on 2026-11-06). `source-probe.due.ts` holds the rule.
 *
 * The lifecycle is `HarvestScheduleWorker`'s: a plain timer with `unref`,
 * cleared on destroy, a flag that stops the loop on the way out, the clock from
 * `HARVEST_CLOCK`, and one tick at a time in a process. It reads no
 * `harvest_schedules` row: a probe is not a preset and starts no run.
 *
 * A tick does three things in order:
 *
 * 1. **The reaper** marks `ABORTED` every `RUNNING` probe older than ten
 *    minutes.
 * 2. **The retention** deletes probes older than 90 days, in the first tick of
 *    each UTC day this process sees.
 * 3. **The claim** starts at most one probe, and waits for it, only when
 *    `HARVEST_ENABLED` and `HARVEST_SCHEDULER_ENABLED` are both true. After a
 *    deploy every chain is due, and one per tick spreads them a minute apart.
 *
 * The first two run whatever the switches say. They fetch nothing, and a
 * manual probe killed with its pod on a cluster whose scheduler is off would
 * otherwise hold its chain `RUNNING` for ever, refusing every probe after it.
 *
 * Nothing a tick meets is thrown out of it.
 */
@Injectable()
export class SourceProbeWorker
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(SourceProbeWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopping = false;
  /** The UTC day of the last retention pass, so it runs once a day. */
  private prunedOn: string | null = null;

  constructor(
    private readonly store: SourceProbeStore,
    private readonly probes: SourceProbeService,
    private readonly config: ConfigService,
    @Inject(HARVEST_CLOCK) private readonly clock: HarvestClock
  ) {}

  private settings(): HarvesterConfig {
    return this.config.getOrThrow<HarvesterConfig>('harvester');
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), PROBE_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  /** One pass: the reaper, the retention, then at most one probe. Public for the specs. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopping) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.clock();
      await this.reap(now);
      await this.prune(now);
      const settings = this.settings();
      if (!settings.harvestEnabled || !settings.schedulerEnabled) {
        return;
      }
      const claimed = await this.store.claimDue(now, PROBED_ADAPTER_KEYS);
      if (claimed) {
        await this.probes.runClaimed(claimed);
      }
    } catch (error) {
      // A timer has no caller to return an error to, so it must never take
      // the process down. The next tick starts again from the table.
      this.logger.error(`Probe tick failed: ${describeError(error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async reap(now: Date): Promise<void> {
    const reaped = await this.store.reap(
      new Date(now.getTime() - PROBE_REAP_AFTER_MS),
      now
    );
    if (reaped > 0) {
      this.logger.warn(
        `Marked ${reaped} probe(s) ABORTED: their process is gone`
      );
    }
  }

  private async prune(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    if (this.prunedOn === day) {
      return;
    }
    const deleted = await this.store.prune(
      new Date(now.getTime() - PROBE_RETENTION_MS)
    );
    this.prunedOn = day;
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} probe(s) older than 90 days`);
    }
  }
}
