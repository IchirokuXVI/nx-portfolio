import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

/**
 * What every tombstone starts with, as core's do (plan 0232, section 1): eight
 * zeros, then 96 random bits. Random and derived from nothing, and still one
 * the reconcile command of section 7 can tell from a user id, so a second run
 * of its release task finds nothing to do.
 */
export const TOMBSTONE_PREFIX = '00000000-';

export function tombstoneId(): string {
  return `${TOMBSTONE_PREFIX}${randomUUID().slice(TOMBSTONE_PREFIX.length)}`;
}

/**
 * Catalog's half of an account deletion (plan 0232, section 6).
 *
 * The only rows of an ordinary account here are the shop walks a person
 * recorded and the entries of their log. Both stay, because the map of a shop
 * is useful to everybody who shops there, and both lose the link: their
 * `createdByUserId` becomes one tombstone, a random uuid generated here and
 * stored nowhere else.
 *
 * One transaction, and no idempotency key: a second delivery of the same id
 * finds no row that still names it, and does nothing.
 */
@Injectable()
export class AccountDeletionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Answers how many rows it rewrote: walks and entries together. */
  async handleUserDeleted(userId: string): Promise<number> {
    const tombstone = tombstoneId();
    return this.dataSource.transaction(async (manager) => {
      let rewritten = 0;
      for (const table of ['shop_walks', 'shop_walk_entries']) {
        // An UPDATE with RETURNING answers `[rows, count]` through `query()`.
        const [, count] = (await manager.query(
          `UPDATE "${table}" SET "createdByUserId" = $2::uuid
            WHERE "createdByUserId" = $1::uuid
           RETURNING 1`,
          [userId, tombstone]
        )) as [unknown[], number];
        rewritten += count;
      }
      return rewritten;
    });
  }
}
