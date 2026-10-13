import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BASKET_CHANGE_LIMITS,
  BasketChangeOriginKind,
  BUY_CHANGE_KINDS,
  type AcknowledgeBasketChangesRequest,
  type BasketChangeActorView,
  type BasketChangeOrigin,
  type BasketChangePage,
  type BasketChangesAcknowledged,
  type BasketChangeView,
  type BasketMarksView,
  type GetBasketMarksRequest,
  type ListBasketChangesRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ListLineChange } from '../../entities';
import { BasketReadService } from '../basket-read.service';
import { BasketWriteContext } from '../basket-write.context';
import { mergeKey } from '../line-dedup';
import {
  ACKNOWLEDGE_CHANGES_SQL,
  BASKET_CHANGES_PAGE_SQL,
  COVERED_CHANGE_SQL,
  VIEWER_START_SQL,
  type ChangeLineRow,
  type ChangePageRow,
  type ViewerStartRow,
} from './basket-changes.sql';
import { BasketMarksReader } from './basket-marks.reader';

/**
 * What a changes cursor carries: the boundary row's id, and nothing else.
 *
 * Not its `createdAt`, which is the trap the older cursors in core carry: an ISO
 * timestamp is milliseconds and a `timestamptz` is microseconds, so a token
 * holding the value skips or repeats the boundary row. The sort key is read back
 * in SQL by id instead, which costs one index lookup.
 */
type ChangeCursor = { id: string } & Record<string, unknown>;

/**
 * The two routes about what changed (plan 0138, sections 6 and 8).
 *
 * ## Reading is a history, and the marks are a nudge
 *
 * The basket read tells a shopper that a row moved while they were looking away.
 * This tells them **what** moved, in order, and it includes the changes they made
 * themselves: somebody scrolling the list of what happened wants their own line in
 * its place in it, where a banner about your own edit is noise.
 *
 * ## Nothing here compares a client's clock to a server's
 *
 * The acknowledgement carries the **id** of the newest change the client drew and
 * answers a **duration**. The cursor pages on an id and reads the boundary row's
 * sort key back in SQL. So the only clock either route trusts is the database's.
 */
@Injectable()
export class BasketChangesService {
  constructor(
    @InjectRepository(ListLineChange)
    private readonly changes: Repository<ListLineChange>,
    private readonly context: BasketWriteContext,
    private readonly read: BasketReadService,
    private readonly marks: BasketMarksReader
  ) {}

  /** One page of what changed, newest first. */
  async list(req: ListBasketChangesRequest): Promise<BasketChangePage> {
    const opened = await this.context.open(req);
    if (opened.coveredListIds.length === 0) {
      // A person in no zone has a basket with nothing in it, so nothing has
      // changed about it. An answer rather than an error, as the read gives.
      return { items: [], nextCursor: null };
    }

    const limit = clampChangePage(req.limit);
    const cursor = decodeCursor<ChangeCursor>(req.cursor);
    const rows = await this.changes.query<ChangePageRow[]>(
      BASKET_CHANGES_PAGE_SQL,
      [
        opened.participant.id,
        [...opened.coveredListIds],
        this.marks.retention,
        cursor?.id ?? null,
        limit + 1,
        // The lists this reader was served, which is what lets the statement
        // load the owner of another basket for them and for nobody else (plan
        // 0203, section 5). Empty for a guest.
        [...opened.servedListIds],
      ]
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // The rows a client can act on: the covered lines, grouped exactly as the
    // basket read groups them, so a `rowKey` here names the row that read drew.
    const covered = await this.read.coveredLinesOf(
      opened.basket,
      opened.coveredListIds
    );
    const anchors = anchorsOf(covered);
    const lines = await this.linesOf(page, covered);

    const items = page.map((row) =>
      toChangeView(row, {
        anchors,
        lines,
        basketId: opened.basket.id,
        servedListIds: opened.servedListIds,
      })
    );
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }

  /**
   * The marks and the count alone (plan 0204, section 6).
   *
   * What a client reads after an event said `marksMoved`: it holds the rows
   * already, so it is answered the one thing a room could not carry, which is
   * what **this viewer** has not seen yet.
   *
   * It reads the coverage, the covered lines and the marked changes. No row is
   * built, so it asks for no product set, no purchase, no walk history, no
   * person and no list name, and the gateway asks the catalog nothing.
   *
   * A mark belongs to a merge key (plan 0138, section 7), and every covered
   * line of that key is answered with it. So a client that folds the marks of
   * the lines of a row gets the mark the read gives that row. **A removed row
   * is not here**: its lines left the coverage, and a removal sends ids alone.
   */
  async marksOf(req: GetBasketMarksRequest): Promise<BasketMarksView> {
    const opened = await this.context.open(req);
    if (opened.coveredListIds.length === 0) {
      return { unseenChangeCount: 0, newestUnseenChangeId: null, lines: [] };
    }
    const covered = await this.read.coveredLinesOf(
      opened.basket,
      opened.coveredListIds
    );
    const marks = await this.marks.marksFor(
      opened.participant.id,
      opened.coveredListIds,
      covered
    );
    return {
      unseenChangeCount: marks.unseenChangeCount,
      newestUnseenChangeId: marks.newestUnseenChangeId,
      lines: covered.flatMap((line) => {
        const mark = marks.byKey.get(mergeKey(line));
        return mark ? [{ lineId: line.id, mark }] : [];
      }),
    };
  }

  /**
   * Say which changes this viewer has drawn (section 6).
   *
   * Three statements and no transaction: the existence check, the viewer's own
   * start, and one upsert that copies the change's `createdAt` across inside the
   * database. There is nothing to serialize, because the upsert's own `WHERE` is
   * what makes two racing acknowledgements end with the newer one.
   */
  async acknowledge(
    req: AcknowledgeBasketChangesRequest
  ): Promise<BasketChangesAcknowledged> {
    const opened = await this.context.open(req);
    const covered = [...opened.coveredListIds];

    // A `through` naming a change of a list this basket does not cover, or one
    // too old to be served, is a `not_found`. Asked before the upsert, because
    // that statement writes nothing in either case and "nothing happened" is not
    // an answer a client can correct.
    const named = await this.changes.query<{ id: string }[]>(
      COVERED_CHANGE_SQL,
      [req.through, covered, this.marks.retention]
    );
    if (named.length === 0) {
      throw new NotFoundException('Change not found');
    }

    const [start] = await this.changes.query<ViewerStartRow[]>(
      VIEWER_START_SQL,
      [opened.participant.id]
    );
    if (start) {
      // As text, exactly as Postgres rendered it, so the microseconds a cursor is
      // compared on survive the round trip. A `Date` here would be milliseconds.
      await this.changes.query(ACKNOWLEDGE_CHANGES_SQL, [
        opened.participant.id,
        req.through,
        start.start,
        covered,
      ]);
    }

    return {
      unseenChangeCount: await this.marks.countFor(
        opened.participant.id,
        covered
      ),
      // A duration, never a moment (section 6). The client may run a timer for it;
      // it never compares its own clock to a time the server sent.
      marksLapseInMs: this.marks.markWindow,
    };
  }

  /** The lines this page names, the ones the basket no longer holds included. */
  private async linesOf(
    page: readonly ChangePageRow[],
    covered: readonly ChangeLineRow[]
  ): Promise<Map<string, ChangeLineRow>> {
    const known = new Map(covered.map((line) => [line.id, line]));
    const wanted = new Set<string>();
    for (const row of page) {
      for (const id of [row.lineId, row.mergedIntoLineId]) {
        if (id && !known.has(id)) {
          wanted.add(id);
        }
      }
    }
    if (wanted.size === 0) {
      return known;
    }
    const rows = await this.read.changeLinesOf([...wanted]);
    for (const row of rows) {
      known.set(row.id, row);
    }
    return known;
  }
}

/** A page size inside this route's own bounds (plan 0138, section 8). */
export function clampChangePage(requested?: number): number {
  if (!requested || Number.isNaN(requested) || requested < 1) {
    return BASKET_CHANGE_LIMITS.pageSize;
  }
  return Math.min(Math.floor(requested), BASKET_CHANGE_LIMITS.maxPageSize);
}

/**
 * The line that names each row, by the row's merge key.
 *
 * The covered lines arrive ordered by `("createdAt", id)`, which is what makes the
 * first line of a group its anchor: the oldest ask for a thing names the row (plan
 * 0136). Written here rather than reusing `groupEntries`, because this needs the
 * anchor of a key and not the group behind it.
 */
export function anchorsOf(
  covered: readonly ChangeLineRow[]
): Map<string, string> {
  const anchors = new Map<string, string>();
  for (const line of covered) {
    const key = mergeKey(line);
    if (!anchors.has(key)) {
      anchors.set(key, line.id);
    }
  }
  return anchors;
}

/** What a change view needs about the basket it is being read through. */
interface ChangeViewContext {
  /** Merge key to the line that names its row. */
  anchors: ReadonlyMap<string, string>;
  /** Every line this page names, deleted ones included. */
  lines: ReadonlyMap<string, ChangeLineRow>;
  /** This basket, so a change made **through it** names its participant. */
  basketId: string;
  /** The lists this reader holds `WRITE` on (plan 0130, section 6). */
  servedListIds: ReadonlySet<string>;
}

/**
 * One change, as this reader is allowed to see it (section 8).
 *
 * `lineId` and `mergedIntoLineId` never reach the wire. What a client can act on
 * is a row, so the address it is given is {@link BasketChangeView.rowKey}, and a
 * change whose line is in no row it can reach carries null rather than an id that
 * would only fail.
 *
 * Exported for the spec, which states the redaction as a table.
 */
export function toChangeView(
  row: ChangePageRow,
  context: ChangeViewContext
): BasketChangeView {
  const view: BasketChangeView = {
    id: row.id,
    kind: row.kind,
    at: new Date(row.createdAt).toISOString(),
    unseen: row.unseen,
    rowKey: rowKeyOf(row, context),
    contentBefore: row.contentBefore,
    contentAfter: row.contentAfter,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    approvalBefore: row.approvalBefore,
    approvalAfter: row.approvalAfter,
    actor: actorViewOf(row, context),
    origin: originOf(row, context),
  };
  // Redaction by absence (plan 0130, section 6). The field is omitted rather than
  // nulled, so a reader cannot tell "a list you may not see" from "no list".
  if (context.servedListIds.has(row.listId)) {
    view.listId = row.listId;
  }
  return view;
}

/**
 * The row this change's line is in now, or null.
 *
 * A merge resolves through the **survivor**, because the absorbed line names no
 * row and the row the change is about is the one that is still there. A deleted
 * line whose name another household still asks for resolves to that household's
 * row, which is the same answer the mark gives it. A line in no covered row at
 * all, which is what a removal usually is, carries null: the disabled row the
 * basket read draws lasts as long as the mark, and this history outlives it.
 */
function rowKeyOf(
  row: ChangePageRow,
  context: ChangeViewContext
): string | null {
  const survivor = row.mergedIntoLineId
    ? context.lines.get(row.mergedIntoLineId)
    : undefined;
  const named = survivor ?? context.lines.get(row.lineId);
  if (!named) {
    return null;
  }
  return context.anchors.get(mergeKey(named)) ?? null;
}

/**
 * Where a buy came from, when it was not made through this basket (plan 0203,
 * section 5).
 *
 * - `LIST`: the buy names no basket, so it was made on the zone list page.
 * - `ANOTHER_BASKET`: it names a basket that is not this one. `owner` is the
 *   owner of that basket, and the statement loaded it only beside a served
 *   list, so it is null for a guest and for a basket that was deleted since.
 * - null for a buy of this basket, which has its participant in `actor`, and
 *   for every change that is not a buy.
 *
 * **No basket id leaves here.** The row holds one, and this reads it to compare
 * and for nothing else.
 */
function originOf(
  row: ChangePageRow,
  context: ChangeViewContext
): BasketChangeOrigin | null {
  if (!BUY_CHANGE_KINDS.includes(row.kind)) {
    return null;
  }
  if (row.basketId === context.basketId) {
    return null;
  }
  if (row.basketId === null) {
    return { kind: BasketChangeOriginKind.LIST };
  }
  return {
    kind: BasketChangeOriginKind.ANOTHER_BASKET,
    owner: row.originOwnerUserId ? { userId: row.originOwnerUserId } : null,
  };
}

/**
 * Who made the change, named the one way this reader may know them.
 *
 * - A change made **through this basket** is served as its participant:
 *   everybody on a basket already sees its people, and `basketId` says so without
 *   a query.
 * - An account otherwise reaches the reader only beside a served `listId`, since
 *   a reader who can write the list is in its zone and already resolves that
 *   person from the membership.
 * - Otherwise null, which is what a guest gets for every change somebody made
 *   from their own list page.
 *
 * Core serves no name, as everywhere else.
 */
function actorViewOf(
  row: ChangePageRow,
  context: ChangeViewContext
): BasketChangeActorView | null {
  if (row.actorParticipantId && row.basketId === context.basketId) {
    return { participantId: row.actorParticipantId };
  }
  if (row.actorUserId && context.servedListIds.has(row.listId)) {
    return { userId: row.actorUserId };
  }
  return null;
}
