import { Injectable } from '@nestjs/common';
import {
  LIVE_GENERATED_LIST_STATUSES,
  TripKind,
  type ListTripRowsRequest,
  type ListTripsRequest,
  type TripPage,
  type TripRowPage,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource } from 'typeorm';
import { LineClaimService } from '../../generated-lists/line-claim.service';
import { ListAccessService } from '../list-access.service';
import { toTripRowView, toTripView } from './trips.mappers';
import {
  BASKET_TRIP_ROWS_SQL,
  ENDED_TRIPS_SQL,
  LIVE_TRIPS_SQL,
  LOOSE_TRIP_GAP_MS,
  LOOSE_TRIP_ROWS_SQL,
  type TripLineRow,
  type TripRow,
} from './trips.sql';

/**
 * What a trips cursor carries: which trip the page ended on, and nothing else.
 *
 * Not its `startedAt`, for the reason `SettlementService` gives: an ISO timestamp
 * is milliseconds and a `timestamptz` is microseconds. The kind says which table
 * the boundary's own sort key is read back from.
 */
interface TripCursor extends Record<string, unknown> {
  kind: TripKind;
  id: string;
}

/** What a rows cursor carries: the boundary zone line's id. */
interface TripRowCursor extends Record<string, unknown> {
  id: string;
}

/** Canonical UUID shape. A trip id reaches a `::uuid` cast, which throws on less. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shopping trips that touched a zone list (plan 0122).
 *
 * A zone list is drawn as groups: what is still to buy, then one group per trip,
 * newest first. A trip is a basket that drew from the list, or a run of
 * purchases somebody settled by hand. This service is the two reads behind those
 * groups.
 *
 * ## Read only, and nothing is copied
 *
 * Every number is derived on read from `generated_list_line_origins` and
 * `line_settlements`. Both stop changing when a basket ends, so an old trip's
 * rows freeze by themselves and never follow the line's live quantity.
 *
 * ## The history is paged twice (section 2)
 *
 * Trips grow without bound, one a week for as long as a household shops, so
 * trip heads come a page at a time and the rows of one trip are read only when
 * somebody opens it. Live trips are the exception: they are bounded by the claim
 * window and a client needs all of them, so they ride whole on the first
 * response.
 *
 * ## What it discloses (section 5)
 *
 * The name and id of a basket owned by somebody else, to a reader of the list.
 * Plan 0052 refused that for the claim event, and the product owner reversed it
 * on 2026-09-17 for these two reads and the list room only. A trip never says
 * what else the basket holds, who takes part, where it shops or what anything
 * costs, and the basket's own routes stay behind the participant guard.
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly listAccess: ListAccessService,
    // For `since()` alone. "Is this basket live" has to be the claim's own
    // window, or a trip reads live while its lines read unclaimed.
    private readonly claims: LineClaimService
  ) {}

  /** The trips of a list, newest first (section 3). `READ`. */
  async list(req: ListTripsRequest): Promise<TripPage> {
    await this.listAccess.requireRead(req.listId, req.userId);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor<TripCursor>(req.cursor);
    // A cursor that does not decode to a trip is "start from the beginning", as
    // `decodeCursor` has it for every other read. The id reaches a `::uuid` cast,
    // so its shape is part of that test.
    const paging =
      cursor &&
      isTripKind(cursor.kind) &&
      typeof cursor.id === 'string' &&
      UUID_PATTERN.test(cursor.id)
        ? cursor
        : null;

    const window = [
      req.listId,
      LOOSE_TRIP_GAP_MS,
      [...LIVE_GENERATED_LIST_STATUSES],
      this.claims.since(),
    ];

    // One after the other rather than together: each query draws a connection
    // from the pool, and a request holding two at once is how the pool runs dry.
    const live = paging
      ? []
      : await this.dataSource.query<TripRow[]>(LIVE_TRIPS_SQL, window);
    const ended = await this.dataSource.query<TripRow[]>(ENDED_TRIPS_SQL, [
      ...window,
      paging?.id ?? null,
      paging?.kind ?? null,
      limit + 1,
    ]);

    const hasMore = ended.length > limit;
    const page = ended.slice(0, limit).map(toTripView);
    const last = page[page.length - 1];
    return {
      live: live.map(toTripView),
      items: page,
      nextCursor:
        hasMore && last ? encodeCursor({ kind: last.kind, id: last.id }) : null,
    };
  }

  /**
   * What one trip did to each zone line of the list (section 4). `READ`.
   *
   * Ordered by the zone line's own `(position, id)`, so a trip reads in the order
   * the list does.
   *
   * **An empty page is not found**, with a cursor or without one. A trip that
   * does not exist touches no line of the list, and neither does one whose lines
   * were all deleted, so both have no rows. With a cursor it means the trip
   * changed under the reader: a reverted purchase can split a session and take
   * its id away. A cursor is only ever issued when another row exists, so an
   * honest empty page cannot happen, and the client's answer to not found is to
   * read the heads again.
   */
  async rows(req: ListTripRowsRequest): Promise<TripRowPage> {
    await this.listAccess.requireRead(req.listId, req.userId);

    if (!isTripKind(req.kind)) {
      throw new ValidationException('kind must be BASKET or LOOSE', {
        messageArgs: { field: 'kind' },
      });
    }
    if (!UUID_PATTERN.test(req.tripId)) {
      // Not a validation failure: an id that cannot name a row names no trip.
      throw new NotFoundException('Trip not found');
    }

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor<TripRowCursor>(req.cursor);
    const cursorId =
      typeof cursor?.id === 'string' && UUID_PATTERN.test(cursor.id)
        ? cursor.id
        : null;

    const rows =
      req.kind === TripKind.BASKET
        ? await this.dataSource.query<TripLineRow[]>(BASKET_TRIP_ROWS_SQL, [
            req.listId,
            req.tripId,
            cursorId,
            limit + 1,
          ])
        : await this.dataSource.query<TripLineRow[]>(LOOSE_TRIP_ROWS_SQL, [
            req.listId,
            LOOSE_TRIP_GAP_MS,
            req.tripId,
            cursorId,
            limit + 1,
          ]);

    if (rows.length === 0) {
      throw new NotFoundException('Trip not found');
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toTripRowView(req.kind, row)),
      nextCursor: hasMore && last ? encodeCursor({ id: last.lineId }) : null,
    };
  }
}

function isTripKind(value: unknown): value is TripKind {
  return value === TripKind.BASKET || value === TripKind.LOOSE;
}
