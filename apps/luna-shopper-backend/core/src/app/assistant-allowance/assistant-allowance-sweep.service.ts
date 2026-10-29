import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AssistantAllowanceService } from './assistant-allowance.service';

/** The first tick waits this long after boot, as the retention sweep's does. */
export const ALLOWANCE_SWEEP_FIRST_TICK_MS = 60_000;

/** How often expired reservations are released (plan 0234, section 5.4). */
export const ALLOWANCE_SWEEP_INTERVAL_MS = 60_000;

/** How often old usage rows are deleted (plan 0234, section 4: once a day). */
export const ALLOWANCE_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The allowance's two chores (plan 0234, sections 4 and 5.4).
 *
 * Every minute it releases reservations whose turn died with its pod: a
 * person's own next reservation releases theirs too, but the deployment's day
 * would otherwise stay fuller than it is until that person came back. Once a
 * day it deletes usage rows past their retention.
 *
 * Shaped like `RetentionSweepService`: an `unref`ed interval with no
 * `@nestjs/schedule`, a `running` flag so ticks never overlap, errors logged and
 * swallowed. Every replica runs it; each expired reservation is taken with
 * `SKIP LOCKED`, so two replicas never wait on each other. It has no switch and
 * no key, because core receives none for the allowance (section 11).
 */
@Injectable()
export class AssistantAllowanceSweepService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AssistantAllowanceSweepService.name);
  private firstTick?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRetentionAtMs = 0;

  constructor(private readonly allowance: AssistantAllowanceService) {}

  onApplicationBootstrap(): void {
    this.firstTick = setTimeout(() => {
      this.firstTick = undefined;
      void this.tick();
      this.timer = setInterval(
        () => void this.tick(),
        ALLOWANCE_SWEEP_INTERVAL_MS
      );
      this.timer.unref();
    }, ALLOWANCE_SWEEP_FIRST_TICK_MS);
    this.firstTick.unref();
  }

  onApplicationShutdown(): void {
    if (this.firstTick) {
      clearTimeout(this.firstTick);
      this.firstTick = undefined;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One tick, skipped while the previous one runs. Public for its spec. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.allowance.releaseExpired(now);
      if (
        now.getTime() - this.lastRetentionAtMs >=
        ALLOWANCE_RETENTION_INTERVAL_MS
      ) {
        const deleted = await this.allowance.deleteOldRows(now);
        this.lastRetentionAtMs = now.getTime();
        if (deleted.personDays > 0 || deleted.deploymentDays > 0) {
          this.logger.log(
            JSON.stringify({
              event: 'assistant.allowance.retention',
              ...deleted,
            })
          );
        }
      }
    } catch (err) {
      this.logger.error(
        'assistant allowance sweep failed',
        err instanceof Error ? err.stack : String(err)
      );
    } finally {
      this.running = false;
    }
  }
}
