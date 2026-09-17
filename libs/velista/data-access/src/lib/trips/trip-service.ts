import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  Page,
  TripKind,
  TripPage,
  TripRow,
} from '@portfolio/velista/models';
import { TripApi } from './trip-api';

/**
 * The shopping trips of one zone list (backend `0122`).
 *
 * Two reads and no writes. A trip changes because a basket or a purchase changed, and
 * the page hears that as a signal to read again (velista `0088`, section 8).
 */
export interface TripServiceI {
  /**
   * One page of trip heads (`GET /v1/lists/:id/trips`), newest first.
   *
   * The live trips ride on the first page only. A page read with a cursor answers
   * `live: []`.
   */
  listTrips(
    listId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<TripPage>;

  /**
   * One page of one trip's rows (`GET /v1/lists/:id/trips/:kind/:tripId/rows`), in the
   * list's order.
   *
   * A trip that no longer exists answers `not_found`, with a cursor or without one. A
   * loose trip's id can disappear when a purchase is undone.
   */
  listTripRows(
    listId: string,
    kind: TripKind,
    tripId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<TripRow>>;
}

/** Inject this, typed as the interface. The default is the real gateway. */
export const TRIP_SERVICE = serviceToken<TripServiceI>('TRIP_SERVICE', () =>
  inject(TripApi)
);
