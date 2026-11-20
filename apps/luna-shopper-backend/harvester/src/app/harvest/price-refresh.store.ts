import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PriceRefreshStatus } from '@portfolio/luna-shopper/contracts';
import { LessThan, Repository } from 'typeorm';
import { PriceRefresh, type StoredPriceRefreshStatus } from '../entities';

/** What a new refresh row records, before the fetch starts. */
export interface NewPriceRefresh {
  requestedByUserId: string;
  supermarketId: string;
  sourceId: string;
  entryId: string;
  itemId: string;
  priceScopeId: string;
  fetchScopeId: string;
}

/** How a fetch ended. */
export interface PriceRefreshOutcome {
  status: Exclude<StoredPriceRefreshStatus, PriceRefreshStatus.PENDING>;
  pricesWritten?: number;
  pricesConfirmed?: number;
  error?: string | null;
}

/**
 * The `price_refreshes` table (plan 0216, section 4), and every query on it.
 *
 * Nothing here takes a lock a run takes, and nothing here reads or writes
 * `harvest_runs`: a refresh is not a run.
 */
@Injectable()
export class PriceRefreshStore {
  constructor(
    @InjectRepository(PriceRefresh)
    private readonly refreshes: Repository<PriceRefresh>
  ) {}

  /** The refresh in flight for one product at one fetch scope, if any. */
  findPending(
    entryId: string,
    fetchScopeId: string
  ): Promise<PriceRefresh | null> {
    return this.refreshes.findOne({
      where: { entryId, fetchScopeId, status: PriceRefreshStatus.PENDING },
      order: { requestedAt: 'DESC' },
    });
  }

  findById(id: string): Promise<PriceRefresh | null> {
    return this.refreshes.findOne({ where: { id } });
  }

  /** A new `PENDING` row, answered with what the database filled in. */
  async insertPending(row: NewPriceRefresh): Promise<PriceRefresh> {
    return this.refreshes.save(
      this.refreshes.create({
        ...row,
        status: PriceRefreshStatus.PENDING,
        pricesWritten: 0,
        pricesConfirmed: 0,
        error: null,
        finishedAt: null,
      })
    );
  }

  /**
   * Write how a fetch ended, on a row that is still `PENDING`.
   *
   * Guarded on the status, so a row the timer already wrote `FAILED` as
   * interrupted is not rewritten by a fetch that came back after it.
   */
  async finish(
    id: string,
    outcome: PriceRefreshOutcome,
    finishedAt: Date
  ): Promise<void> {
    await this.refreshes.update(
      { id, status: PriceRefreshStatus.PENDING },
      {
        status: outcome.status,
        pricesWritten: outcome.pricesWritten ?? 0,
        pricesConfirmed: outcome.pricesConfirmed ?? 0,
        error: outcome.error ?? null,
        finishedAt,
      }
    );
  }

  /**
   * Every row still `PENDING` that was requested before `before` becomes
   * `FAILED` with the error "interrupted" (section 4). A restart of the pod is
   * the only way to leave one behind. Answers how many it wrote.
   */
  async reapInterrupted(before: Date, now: Date): Promise<number> {
    const result = await this.refreshes.update(
      { status: PriceRefreshStatus.PENDING, requestedAt: LessThan(before) },
      {
        status: PriceRefreshStatus.FAILED,
        error: 'interrupted',
        finishedAt: now,
      }
    );
    return result.affected ?? 0;
  }

  /** Delete every row requested before `before`. Answers how many. */
  async deleteOlderThan(before: Date): Promise<number> {
    const result = await this.refreshes.delete({
      requestedAt: LessThan(before),
    });
    return result.affected ?? 0;
  }
}
