import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import type { CatalogConfig } from '../config/app-config';
import type { RetentionConfig } from './retention-config';

/** The first tick waits this long after boot (plan 0233, section 2). */
export const RETENTION_FIRST_TICK_DELAY_MS = 60_000;

/** One table the sweep walks (plan 0233, section 2). */
export interface RetentionTarget {
  /** The table, written into the statement as a quoted identifier. */
  table: string;
  /** The time column of section 1. */
  column: string;
  /** How long a row is kept past {@link column}. */
  retainMs: number;
  /** A further condition. Only auth's `impersonation_sessions` has one. */
  extraWhere?: string;
}

/** What one table gave up in one sweep. */
export interface RetentionResult {
  table: string;
  deleted: number;
  /** A statement failed. The table is tried again on the next tick. */
  failed: boolean;
}

/**
 * The tables catalog sweeps (plan 0233, section 1): its audit trail, and nothing
 * else. A row inside its lifetime is never touched.
 */
export function catalogRetentionTargets(
  cfg: RetentionConfig
): readonly RetentionTarget[] {
  return [{ table: 'catalog_audit', column: 'at', retainMs: cfg.auditMs }];
}

/**
 * One batch of one table: `$1` is the cutoff, `$2` the batch size.
 *
 * `FOR UPDATE SKIP LOCKED` lets two replicas sweep at once: each takes rows
 * the other has not locked, and neither waits for the other's batch.
 */
export function retentionDeleteSql(target: RetentionTarget): string {
  const extra = target.extraWhere ? ` AND (${target.extraWhere})` : '';
  return (
    `DELETE FROM "${target.table}" WHERE "id" IN (` +
    `SELECT "id" FROM "${target.table}" ` +
    `WHERE "${target.column}" < $1${extra} ` +
    `ORDER BY "${target.column}" LIMIT $2 FOR UPDATE SKIP LOCKED)`
  );
}

/**
 * The rows a `DELETE` removed. The postgres driver answers a `DELETE` through
 * `query()` as `[rows, rowCount]`; any other shape is refused rather than read
 * as zero, which would end the loop with rows left.
 */
export function deletedCount(answered: unknown): number {
  if (Array.isArray(answered) && typeof answered[1] === 'number') {
    return answered[1];
  }
  throw new Error('retention sweep: unexpected DELETE result shape');
}

/**
 * Deletes the rows whose lifetime has ended (plan 0233).
 *
 * Shaped like auth's `OrphanUserReaperService`: an `unref`ed interval with no
 * `@nestjs/schedule`, a `running` flag so ticks never overlap, cleared on
 * shutdown, errors logged and swallowed. The first tick runs one minute after
 * boot rather than at boot, so a crash looping pod does not sweep on every
 * start.
 *
 * Every replica runs it. Each batch is its own short statement, and `SKIP
 * LOCKED` keeps two replicas from waiting on each other's batches.
 */
@Injectable()
export class RetentionSweepService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cfg: RetentionConfig;
  private readonly targets: readonly RetentionTarget[];
  private firstTick?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: Logger,
    configService: ConfigService
  ) {
    this.cfg = configService.getOrThrow<CatalogConfig>('catalog').retention;
    this.targets = catalogRetentionTargets(this.cfg);
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.sweep.enabled) {
      return;
    }
    this.firstTick = setTimeout(() => {
      this.firstTick = undefined;
      void this.tick();
      this.timer = setInterval(
        () => void this.tick(),
        this.cfg.sweep.intervalMs
      );
      this.timer.unref();
    }, RETENTION_FIRST_TICK_DELAY_MS);
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

  /** One tick, skipped while the previous one runs. */
  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error({ err }, 'retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Walks every target once. Public so a spec can run it with a fixed clock
   * and no timers.
   *
   * The cutoff of each table is computed here, once per sweep, so every batch
   * of a sweep agrees on it. A table whose statement fails is logged and left
   * for the next tick, and the walk goes on to the next table.
   */
  async sweep(now: Date = new Date()): Promise<RetentionResult[]> {
    const results: RetentionResult[] = [];
    for (const target of this.targets) {
      const result = await this.sweepTarget(target, now);
      if (result.deleted > 0) {
        this.logger.log(
          { table: result.table, deleted: result.deleted },
          'retention sweep deleted rows past their lifetime'
        );
      }
      results.push(result);
    }
    return results;
  }

  private async sweepTarget(
    target: RetentionTarget,
    now: Date
  ): Promise<RetentionResult> {
    const cutoff = new Date(now.getTime() - target.retainMs);
    const sql = retentionDeleteSql(target);
    const { batchSize, maxBatches } = this.cfg.sweep;
    let deleted = 0;
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        const count = deletedCount(
          await this.dataSource.query(sql, [cutoff, batchSize])
        );
        deleted += count;
        if (count < batchSize) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        { err, table: target.table },
        'retention sweep failed on a table'
      );
      return { table: target.table, deleted, failed: true };
    }
    return { table: target.table, deleted, failed: false };
  }
}
