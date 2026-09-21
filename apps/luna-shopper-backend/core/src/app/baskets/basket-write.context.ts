import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BasketRowState,
  RealtimeEvent,
  type BasketLinesChangedEvent,
  type BasketRowResult,
  type BasketRowView,
  type LineWriteVia,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { GeneratedList, GeneratedListParticipant } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListSharingService } from '../generated-lists/generated-list-sharing.service';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRowResolver, type BasketRow } from './basket-row-resolver';

/**
 * What every write on a row needs before it may touch anything (plan 0136,
 * section 5).
 *
 * The five writes share a resolver, a coverage, a redaction, an event and an
 * answer shape. They are five services because they are five different
 * operations on the database, and this is the part that is the same in all of
 * them, gathered once rather than copied five times and drifting.
 *
 * **Everything here runs before a transaction opens** (plan 0130, section 13).
 * Every repository the access service holds draws its own connection from the
 * pool, so asking it a question from inside a transaction means one request
 * holding two, which deadlocks the pool under load rather than failing honestly.
 */
@Injectable()
export class BasketWriteContext {
  constructor(
    @InjectRepository(GeneratedList)
    private readonly baskets: Repository<GeneratedList>,
    private readonly coverage: BasketCoverageService,
    private readonly sharing: GeneratedListSharingService,
    private readonly resolver: BasketRowResolver,
    private readonly read: BasketReadService
  ) {}

  /** Load the basket, the actor, the coverage and the redaction. */
  async open(req: {
    basketId: string;
    participantId: string;
  }): Promise<OpenBasketWrite> {
    const basket = await this.baskets.findOne({ where: { id: req.basketId } });
    if (!basket) {
      throw new NotFoundException('Basket not found');
    }

    // The row is read live, so a revocation between the gateway's guard and
    // here is refused rather than admitted on a credential checked a hop ago.
    //
    // `liveParticipantById` rather than `livePresenceEntry`, which is the same
    // lookup with fewer columns: the redaction asks about the participant's
    // account and the read composes them, so the whole row is wanted and asking
    // twice would be one query for the attribution and one for everything else.
    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      basket.id
    );
    if (!participant) {
      throw new ForbiddenException('Not a participant of this basket');
    }

    const covered = await this.coverage.listsOf(basket);
    const coveredListIds = covered.map((row) => row.listId);
    const servedListIds = participant.userId
      ? await this.sharing.writableAmong(participant.userId, coveredListIds)
      : new Set<string>();

    return new OpenBasketWrite(
      basket,
      participant,
      coveredListIds,
      new Map(covered.map((row) => [row.listId, row.zoneId])),
      servedListIds,
      this.resolver,
      this.read
    );
  }
}

/** One write, with everything it may read already answered. */
export class OpenBasketWrite {
  constructor(
    readonly basket: GeneratedList,
    /** The actor: attribution, the redaction and the answer all read this row. */
    readonly participant: GeneratedListParticipant,
    readonly coveredListIds: readonly string[],
    private readonly zones: ReadonlyMap<string, string>,
    /** The covered lists this actor writes themselves (section 3.4). */
    readonly servedListIds: ReadonlySet<string>,
    private readonly resolver: BasketRowResolver,
    private readonly read: BasketReadService
  ) {}

  /** The entries of one row, refusing anything outside the coverage. */
  row(rowKey: string): Promise<BasketRow> {
    return this.resolver.resolve(this.basket, this.coveredListIds, rowKey);
  }

  /**
   * Who this write is, as the change record names them (plan 0138, section 4).
   *
   * The **actor's** identity and not the account the write was authorized
   * against. Those differ on every delegated write: changing what a household
   * asks for is checked against the basket's owner (plan 0131) while the person
   * doing it may be a guest, so `userId` here is the participant's own account
   * and is null for a guest.
   */
  via(): LineWriteVia {
    return {
      participantId: this.participant.id,
      basketId: this.basket.id,
      userId: this.participant.userId,
    };
  }

  /**
   * The zone a covered list is in.
   *
   * Read off the coverage rather than joined back through the list, which is
   * what the settle path already did with a provenance row's own copy: the
   * answer is in hand and a join would ask for it twice.
   */
  zoneOf(listId: string): string {
    const zoneId = this.zones.get(listId);
    if (!zoneId) {
      // Unreachable while the list is covered, since coverage is a join through
      // the zone. Throwing beats emitting an event addressed to `undefined`.
      throw new NotFoundException('List not found');
    }
    return zoneId;
  }

  /**
   * Tell the basket that some of its rows moved (plan 0136, section 8).
   *
   * One envelope to the basket's room **and** the owner's own sessions. The
   * owner is usually not in the room: they are at home looking at the dashboard
   * while somebody else shops. An owner who is in both hears it twice, which
   * costs nothing, because the client's reaction is to read the basket again,
   * debounced.
   */
  announceLinesChanged(
    lineIds: readonly string[],
    events: CoreEventsPublisher
  ): void {
    if (lineIds.length === 0) {
      return;
    }
    const payload: BasketLinesChangedEvent = { lineIds: [...new Set(lineIds)] };
    events.emitTo(
      RealtimeEvent.BasketLinesChanged,
      { generatedListId: this.basket.id, userIds: [this.basket.ownerUserId] },
      payload
    );
  }

  /**
   * The row as it now stands, and the basket's progress.
   *
   * A full read, because `progress` is a count over every row and a client that
   * had to refetch to redraw its header would make the same read one round trip
   * later.
   *
   * The row is found by the lines the write touched rather than by the key the
   * request used, because a write can move the key: the anchor may have been
   * bought to zero, or a rename may have folded this row into another. When the
   * request's key still names an entry it is found the same way.
   */
  async result(
    lineIds: readonly string[],
    requestedRowKey: string
  ): Promise<BasketRowResult> {
    const view = await this.read.view(this.basket, this.participant);
    const wanted = new Set([...lineIds, requestedRowKey]);
    const row = view.rows.find(
      (candidate) =>
        candidate.rowKey === requestedRowKey ||
        candidate.entries.some((entry) => wanted.has(entry.lineId))
    );
    return {
      row: row ?? emptyRow(requestedRowKey),
      progress: view.progress,
      ...(row && row.rowKey !== requestedRowKey
        ? { replacedRowKey: requestedRowKey }
        : {}),
    };
  }
}

/**
 * The row a write emptied.
 *
 * `BasketRowResult.row` is never null, and a row whose last entry was taken to
 * zero with nothing bought leaves the view entirely: it is not a thing to buy
 * any more. Answering zeros is the honest description of that, and it lets the
 * client draw the row out rather than branch on a missing field.
 */
function emptyRow(rowKey: string): BasketRowView {
  return {
    rowKey,
    content: '',
    left: 0,
    bought: 0,
    asked: 0,
    state: BasketRowState.WANTED,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [],
  };
}
