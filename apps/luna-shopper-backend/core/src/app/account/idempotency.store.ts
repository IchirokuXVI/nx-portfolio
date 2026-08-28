import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { IdempotencyStore } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
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
}
