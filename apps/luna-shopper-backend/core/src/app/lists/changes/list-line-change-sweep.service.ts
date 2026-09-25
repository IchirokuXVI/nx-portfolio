import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import type { CoreConfig } from '../../config/app-config';
import { ListLineChange } from '../../entities';
import { DELETE_STALE_CHANGES_SQL } from './list-line-change.sql';

/**
 * Deleting changes nobody may read any more (plan 0138, section 10).
 *
 * ## No read depends on it
 *
 * Both change reads filter `"createdAt" >= now() - retention` themselves, so a
 * row this has not reached yet is already invisible and a row it deleted was
 * already invisible. That is deliberate: a sweep that a read trusted would make
 * "what a shopper sees" depend on whether a timer fired, which is the one thing a
 * background task must never decide.
 *
 * So what this buys is the table's size and nothing else, which is why the batch
 * is large where the other sweeps' are small: it deletes rows nobody is looking
 * at, in the order they were written.
 *
 * Shaped like {@link BasketSweepService} rather than inventing a second
 * background style: an `unref`ed interval that never holds the process open, a
 * `running` flag so two ticks cannot overlap, a cap per tick, and a
 * {@link sweep} a spec calls directly with no timers involved.
 */
@Injectable()
export class ListLineChangeSweepService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cfg: CoreConfig['listLineChange'];
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(ListLineChange)
    private readonly changes: Repository<ListLineChange>,
    private readonly logger: Logger,
    configService: ConfigService
  ) {
    this.cfg = configService.getOrThrow<CoreConfig>('core').listLineChange;
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.sweep.enabled) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.cfg.sweep.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error({ err }, 'list line change sweep failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Delete one batch of changes older than the retention, oldest first.
   *
   * The cutoff is computed by the **database**, as `now() - retention`, for the
   * reason every other comparison in this plan is: an application server's clock
   * must not decide what is still readable.
   */
  async sweep(): Promise<number> {
    // `RETURNING "id"` rather than the driver's affected count, which
    // `repository.query` does not hand back for a `DELETE`: it answers the rows
    // and drops the count.
    //
    // **And what it answers is not the plain row array a `SELECT` gives**, which
    // is the trap `basket.sql.ts` records about `UPDATE ... RETURNING`: this
    // driver hands back `[rows, rowCount]`, so reading `.length` off the answer
    // counts two whatever the batch deleted. Measured, not assumed, and unwrapped
    // here rather than trusted.
    const answered = (await this.changes.query(DELETE_STALE_CHANGES_SQL, [
      this.cfg.retentionMs,
      this.cfg.sweep.batchSize,
    ])) as unknown;
    const rows =
      Array.isArray(answered) && Array.isArray(answered[0])
        ? answered[0]
        : answered;
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      this.logger.log(
        { count },
        'list line change sweep deleted changes past the retention'
      );
    }
    return count;
  }
}
