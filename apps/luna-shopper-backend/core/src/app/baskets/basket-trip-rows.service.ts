import { Injectable } from '@nestjs/common';
import { type EntityManager } from 'typeorm';
import {
  BASKET_TRIP_ROWS_FREEZE_SQL,
  BASKET_TRIP_ROWS_THAW_SQL,
} from './basket-trip-rows.sql';

/**
 * The numbers are frozen by the finish (plan 0135).
 *
 * A basket has rows in `basket_trip_rows` exactly while its status is not
 * `OPEN`. That is the whole service: one write when a basket stops being open,
 * one delete when it becomes open again. Every read of a finished trip's ask
 * leans on the invariant, so both calls belong inside the transaction that
 * changes the status and nowhere else.
 *
 * It holds no repository and takes the caller's `EntityManager`, as
 * `LineMergeService` does, so it runs inside the caller's transaction and draws
 * no second connection from the pool (`line.service.ts` explains why that
 * deadlocks).
 */
@Injectable()
export class BasketTripRowsService {
  /**
   * Write what this basket asked of every zone line.
   *
   * Idempotent, so a caller that cannot tell whether the rows are already there
   * may call it anyway.
   */
  async freeze(manager: EntityManager, basketId: string): Promise<void> {
    await manager.query(BASKET_TRIP_ROWS_FREEZE_SQL, [basketId]);
  }

  /** Delete them. The basket is open again and its lists answer for it. */
  async thaw(manager: EntityManager, basketId: string): Promise<void> {
    await manager.query(BASKET_TRIP_ROWS_THAW_SQL, [basketId]);
  }
}
