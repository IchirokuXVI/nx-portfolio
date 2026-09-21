import { Injectable } from '@nestjs/common';
import {
  PURCHASE_SESSION_GAP_MS,
  TripKind,
  type ListPurchaseSessionRowsRequest,
  type ListPurchaseSessionsRequest,
  type PurchaseEntryPage,
  type PurchaseRowPage,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource } from 'typeorm';
import { toPurchaseEntryView, toPurchaseRowView } from './purchases.mappers';
import {
  PURCHASE_BASKET_ROWS_SQL,
  PURCHASE_ENTRIES_SQL,
  PURCHASE_SESSION_ROWS_SQL,
  type PurchaseEntryRow,
  type PurchaseLineRow,
} from './purchases.sql';

/**
 * What an entries cursor carries: which entry the page ended on, and nothing
 * else.
 *
 * Not its `startedAt`, for the reason `TripsService` gives: an ISO timestamp is
 * milliseconds and a `timestamptz` is microseconds. The kind says which table
 * the boundary's own sort key is read back from.
 */
interface EntryCursor extends Record<string, unknown> {
  kind: TripKind;
  id: string;
}

/** What a rows cursor carries: the boundary row's earliest settlement. */
interface RowCursor extends Record<string, unknown> {
  id: string;
}

/** Canonical UUID shape. Every id here reaches a `::uuid` cast. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What one person bought, with or without a basket (plan 0142).
 *
 * The history page used to read the baskets somebody owned, which was the whole
 * history while a purchase needed a basket. It does not any more: the permanent
 * basket is one row that never ends and a purchase needs no trip at all (plan
 * 0130, section 9), so a person who never creates a basket had an empty history
 * however much they bought. This is the read that answers them.
 *
 * ## An account, and only their own
 *
 * The user id comes from the token and is never a parameter of the route. There
 * is no access check to make beyond that, because the read is defined as the
 * reader's own purchases: `PERSON_PURCHASES_CTE` is the authorization.
 *
 * ## Read only, and one statement at a time
 *
 * Every number is derived on read and nothing is stored. Each read runs one
 * statement, so a request never holds two pooled connections at once.
 *
 * ## What it discloses (section 5)
 *
 * Nothing a person did not already know, to nobody else. One case is worth
 * naming: a row keeps a purchase made on a list the reader has since left, and
 * withholds the list. A purchase made by **somebody else** reaches a reader
 * only through a basket the reader owns, where they were always told who was on
 * it. `settledByUserId`, `settledByParticipantId` and `basketId` are never
 * served.
 */
@Injectable()
export class PurchasesService {
  constructor(private readonly dataSource: DataSource) {}

  /** A page of the caller's history, newest first (section 3). */
  async listSessions(
    req: ListPurchaseSessionsRequest
  ): Promise<PurchaseEntryPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor<EntryCursor>(req.cursor);
    // A cursor that does not decode to an entry is "start from the beginning",
    // as `decodeCursor` has it everywhere else. The id reaches a `::uuid` cast,
    // so its shape is part of that test.
    const paging =
      cursor &&
      isTripKind(cursor.kind) &&
      typeof cursor.id === 'string' &&
      UUID_PATTERN.test(cursor.id)
        ? cursor
        : null;

    const rows = await this.dataSource.query<PurchaseEntryRow[]>(
      PURCHASE_ENTRIES_SQL,
      [
        req.userId,
        PURCHASE_SESSION_GAP_MS,
        paging?.id ?? null,
        paging?.kind ?? null,
        limit + 1,
      ]
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(toPurchaseEntryView);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last ? encodeCursor({ kind: last.kind, id: last.id }) : null,
    };
  }

  /**
   * The rows of one entry, in the order the shopper walked (section 4).
   *
   * **An empty page is not found**, with a cursor or without one, for the
   * reason `TripsService.rows` gives. An entry that does not exist, is not the
   * reader's, or has had every purchase reverted has no rows, and a reverted
   * purchase can split a session and take its id away. A cursor is only ever
   * issued when another row exists, so an honest empty page cannot happen, and
   * the client's answer to not found is to read the entries again.
   */
  async listSessionRows(
    req: ListPurchaseSessionRowsRequest
  ): Promise<PurchaseRowPage> {
    if (!isTripKind(req.kind)) {
      throw new ValidationException('kind must be BASKET or SESSION', {
        messageArgs: { field: 'kind' },
      });
    }
    if (!UUID_PATTERN.test(req.entryId)) {
      // Not a validation failure: an id that cannot name a row names no entry.
      throw new NotFoundException('Purchase entry not found');
    }

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor<RowCursor>(req.cursor);
    const cursorId =
      typeof cursor?.id === 'string' && UUID_PATTERN.test(cursor.id)
        ? cursor.id
        : null;

    const rows =
      req.kind === TripKind.BASKET
        ? await this.dataSource.query<PurchaseLineRow[]>(
            PURCHASE_BASKET_ROWS_SQL,
            [req.userId, req.entryId, cursorId, limit + 1]
          )
        : await this.dataSource.query<PurchaseLineRow[]>(
            PURCHASE_SESSION_ROWS_SQL,
            [
              req.userId,
              PURCHASE_SESSION_GAP_MS,
              req.entryId,
              cursorId,
              limit + 1,
            ]
          );

    if (rows.length === 0) {
      throw new NotFoundException('Purchase entry not found');
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toPurchaseRowView),
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }
}

function isTripKind(value: unknown): value is TripKind {
  return value === TripKind.BASKET || value === TripKind.SESSION;
}
