import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { IdempotencyStore } from '@portfolio/luna-shopper/platform';
import { Repository, type EntityManager } from 'typeorm';
import { ProcessedEvent } from '../entities';

/**
 * A TypeORM-backed {@link IdempotencyStore} (plan 0011). `firstSeen` inserts the
 * key with `ON CONFLICT DO NOTHING` and reports whether a row was actually
 * written, so the check and the record are one atomic statement: only the first
 * caller for a key gets `true`, every redelivery gets `false`.
 */
@Injectable()
export class ProcessedEventStore implements IdempotencyStore {
  constructor(
    @InjectRepository(ProcessedEvent)
    private readonly repo: Repository<ProcessedEvent>
  ) {}

  async firstSeen(key: string): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values({ key })
      .orIgnore()
      .returning('key')
      .execute();
    // A row is returned only when the insert actually happened (not on conflict).
    return result.raw.length > 0;
  }

  /**
   * {@link firstSeen} inside the caller's transaction (plan 0232, section 5).
   *
   * The key is then part of the work it guards: a rollback takes it back, and
   * the redelivery that follows does the whole thing again. A second caller of
   * the same key waits on the unique index until the first commits or rolls
   * back, and gets the answer that outcome gives.
   */
  async firstSeenIn(manager: EntityManager, key: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ProcessedEvent)
      .values({ key })
      .orIgnore()
      .returning('key')
      .execute();
    return result.raw.length > 0;
  }
}
