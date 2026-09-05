import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  EffectivePriceService,
  type PriceKey,
} from './effective-price.service';

/** How often a replica looks for rows whose boundary has passed. */
export const SWEEP_INTERVAL_MS = 60_000;

/** How many rows one tick takes. Two replicas take different ones. */
export const SWEEP_BATCH = 500;

/**
 * Keeps the materialized rows current when time, not a write, changes the
 * answer (plan 0080, section 7).
 *
 * A leaflet window opens or closes, an `ADMIN` row's protection runs out, a
 * crawl price reaches its max age: each of those is an instant the recompute
 * wrote into `nextBoundaryAt`, and this is what acts on it. Catalog has no
 * scheduler and neither has any service in this backend; the harvester's
 * postal code discovery worker is the precedent, and this is the same shape: a
 * plain `setInterval` from `onModuleInit`, `unref` so a pending tick never
 * keeps the process alive during a shutdown drain, cleared on destroy.
 *
 * Catalog runs two replicas. `FOR UPDATE SKIP LOCKED` gives each a different
 * set of rows, and the recompute is idempotent, so the worst case of two sweeps
 * meeting is wasted work and never a wrong answer.
 */
@Injectable()
export class EffectivePriceSweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EffectivePriceSweep.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly effective: EffectivePriceService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass: the due rows, locked, recomputed and committed. Answers how many
   * it took, so a spec can prove that a second pass takes none.
   */
  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) {
      // A slow pass must not be joined by the next tick on the same replica.
      return 0;
    }
    this.running = true;
    try {
      return await this.dataSource.transaction(async (manager) => {
        const due = await manager.query<PriceKey[]>(
          `SELECT "id", "itemId", "priceScopeId"
           FROM "supermarket_items"
           WHERE "nextBoundaryAt" <= $1
           ORDER BY "nextBoundaryAt"
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [now, SWEEP_BATCH]
        );
        if (due.length === 0) {
          return 0;
        }
        await this.effective.recompute(
          manager,
          due.map((row) => ({
            itemId: row.itemId,
            priceScopeId: row.priceScopeId,
          })),
          now
        );
        return due.length;
      });
    } catch (error) {
      this.logger.warn(`Effective price sweep failed: ${String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
