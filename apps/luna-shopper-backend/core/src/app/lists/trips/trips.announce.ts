import {
  RealtimeEvent,
  type ListTripsChangedEvent,
} from '@portfolio/luna-shopper/contracts';
import type { CoreEventsPublisher } from '../../events/core-events.publisher';
import { BASKET_TRIP_LISTS_SQL, OWNER_TRIP_LISTS_SQL } from './trips.sql';

/**
 * Telling a list room that a basket touching the list changed (plan 0122,
 * section 6).
 *
 * Plain functions rather than a provider, for two reasons. The services that
 * call them are built positionally in both spec kinds, so one more constructor
 * argument shifts every argument after it in a dozen files. And they need nothing
 * a caller does not already hold: a way to run a query, and the publisher.
 *
 * Each takes the query function rather than a `DataSource`, as `readLineClaims`
 * does, so the same code answers from outside a transaction and from inside one.
 */
type Query = (sql: string, parameters: unknown[]) => Promise<unknown>;

interface ListIdRow {
  listId: string;
}

/**
 * The lists one basket draws from, by its coverage (plan 0136, section 7.2).
 *
 * **Read it before a delete.** The sources cascade away with the basket, so
 * afterwards there is nothing left to ask.
 */
export async function tripListsOfBasket(
  query: Query,
  generatedListId: string
): Promise<string[]> {
  const rows = (await query(BASKET_TRIP_LISTS_SQL, [
    generatedListId,
  ])) as ListIdRow[];
  return rows.map((row) => row.listId);
}

/** The lists every basket of one owner draws from, for an account deletion. */
export async function tripListsOfOwner(
  query: Query,
  ownerUserId: string
): Promise<string[]> {
  const rows = (await query(OWNER_TRIP_LISTS_SQL, [
    ownerUserId,
  ])) as ListIdRow[];
  return rows.map((row) => row.listId);
}

/**
 * Tell each list's room to read its trips again, once per distinct list.
 *
 * **One event per list per write, never one per line** (plan 0052, section 3.1).
 * The audience is the list alone: the `list:{listId}` room is behind core's
 * `READ` check, which is the same check the two reads make, and the zone room is
 * wider than that.
 *
 * Call it after the write has committed, as every announcement in core is.
 */
export function announceTripsChanged(
  events: Pick<CoreEventsPublisher, 'emitTo'>,
  listIds: Iterable<string>
): void {
  for (const listId of new Set(listIds)) {
    const payload: ListTripsChangedEvent = { listId };
    events.emitTo(RealtimeEvent.ListTripsChanged, { listId }, payload);
  }
}
