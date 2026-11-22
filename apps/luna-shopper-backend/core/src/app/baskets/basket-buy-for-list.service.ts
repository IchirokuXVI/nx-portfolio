import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  isOpenBasket,
  LINE_QUANTITY_MAX,
  LineApprovalStatus,
  NO_LINE_CLAIM,
  RealtimeEvent,
  SettlementOutcome,
  type BasketRowResult,
  type BuyForListBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  BasketLineAlreadyInRowException,
  BasketRowHasNoProductException,
  ForbiddenException,
  isUuid,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, IsNull, Repository, type EntityManager } from 'typeorm';
import { Basket, LineSettlement, ListLine, ListLineItem } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  actorOf,
  LineChangeRecorder,
} from '../lists/changes/line-change.recorder';
import { assertLineUnit, requireLineUnit } from '../lists/line-unit-rules';
import { LineService } from '../lists/line.service';
import { toLineSettlementView, toLineView } from '../lists/list.mappers';
import { itemSnapshotColumn, paidColumns } from '../lists/settlement-paid';
import { basketScopeOf, type BasketScope } from './basket-line-facts';
import { elsewhereGapOf } from './basket-read.service';
import { COVERED_LINES_BY_ID_SQL } from './basket-read.sql';
import {
  resolvePick,
  zoneLineItemSet,
  type ZoneAnnouncement,
} from './basket-settle.service';
import {
  BasketWriteContext,
  type OpenBasketWrite,
} from './basket-write.context';
import { LineClaimService } from './line-claim.service';

/**
 * A buy for a covered list that does not ask for the row's product (plan
 * 0273).
 *
 * The section "Add it to another list" of the basket's line sheet records a
 * buy for a list with no line of the product, or with one at zero and no buy
 * in this trip. Neither is an entry of the row, so the settle cannot reach it:
 * the resolver answers "Row not found". This write makes the list's line at
 * zero when it has none and records the buy on it, **in one transaction**, so
 * a failure leaves no line behind (the owner, 2026-11-22). From then on the
 * line is an entry of the row, and a plus or a minus on it is the plain settle
 * and revert.
 *
 * ## Who may
 *
 * A participant with an account who holds `WRITE` on the list themselves, as
 * for the basket's add: the buy can create a line on a household's list, and
 * that is never delegated. A guest is refused before anything is read. A list
 * the basket does not cover answers 404, and one the actor may not write 403
 * (plan 0273, section 1, spec 5).
 *
 * ## The line goes through the list's add
 *
 * {@link LineService.lineAtZeroWithin} finds the list's line of the product as
 * the list's add finds it and creates one through the add's own create, so its
 * position, its `ADDED` change row and its `line.added` are those of any added
 * line. Its access is read before the transaction, as every access read is
 * (plan 0130, section 13).
 *
 * ## The buy is a settle's
 *
 * One `line_settlements` row, `BOUGHT`, with the price columns and the snapshot
 * a settle writes, and the line's quantity left at zero. The `line.settled`
 * event and the patch to every covering basket are the settle's too, sent
 * after the commit.
 */
@Injectable()
export class BasketBuyForListService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    private readonly context: BasketWriteContext,
    private readonly lines: LineService,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher,
    private readonly changes: LineChangeRecorder
  ) {}

  async buyForList(req: BuyForListBasketRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new BasketFinishedException(
        'This basket is finished, so nothing more can be settled in it'
      );
    }
    if (!opened.participant.userId) {
      // Refused before anything is read, with the add's refusal: a guest has
      // no account, so there is no `WRITE` to hold and no list to name.
      throw new ForbiddenException(
        'Only people with an account can add a line to a basket'
      );
    }
    if (!opened.coveredListIds.includes(req.targetListId)) {
      throw new NotFoundException('List not found');
    }
    if (!opened.servedListIds.has(req.targetListId)) {
      throw new ForbiddenException('That list cannot be added to from here');
    }

    const unit = requireLineUnit(req.unit);
    const quantity = validQuantity(req.quantity);
    if (
      req.lineId !== undefined &&
      (typeof req.lineId !== 'string' || !isUuid(req.lineId))
    ) {
      throw new ValidationException('lineId must name a line', {
        messageArgs: { field: 'lineId' },
      });
    }
    // The row the client drew, which must still be one: the answer is read
    // for it, beside the line this writes on.
    const row = await opened.row(req.rowKey, [req.rowKey]);
    // The product bought is the row's, by the settle's own rule, and never
    // one a client names (plan 0273, amended on 2026-11-22): this write can
    // make a line on another household's list. Read here, before the
    // transaction, by the resolver every write on a row reads with, as the
    // settle of a row that names no product reads it.
    const itemId = resolvePick(row, undefined);
    if (itemId === null) {
      throw new BasketRowHasNoProductException(
        'This row has no product, so it cannot be bought for another list'
      );
    }

    const paid = paidColumns(req.paid, SettlementOutcome.BOUGHT);
    const itemSnapshot = itemSnapshotColumn(req.itemSnapshot);
    // Read before the transaction, on the pool, for the reason every read of
    // the context is (plan 0130, section 13).
    const scope = await basketScopeOf(this.baskets, opened.basket);
    const prepared =
      req.lineId === undefined
        ? await this.lines.prepareLineAtZero({
            userId: req.userId,
            listId: req.targetListId,
            itemId,
            unit,
            content: nameOf(req),
            via: opened.via(),
          })
        : null;
    const actor = actorOf({ via: opened.via() });
    const zoneId = opened.zoneOf(req.targetListId);

    let created: ListLine | null = null;
    let recorded = false;
    let announcement: ZoneAnnouncement | undefined;

    await this.dataSource.transaction(async (manager) => {
      let line: ListLine;
      if (prepared === null) {
        line = await this.lockNamedLine(manager, req, itemId);
      } else {
        const found = await this.lines.lineAtZeroWithin(manager, prepared);
        line = found.line;
        // The line as it was born, which its `line.added` carries: the bump
        // below belongs to the buy and to the `line.settled` after it.
        created = found.created ? { ...found.line } : null;
      }
      assertLineUnit(line, unit);
      // A line that is already an entry is bought with the plain settle, so
      // the client is told to use it. Asked under the line's lock and through
      // this transaction's connection, by the statement the read draws with.
      if (
        created === null &&
        (await isEntryOf(manager, opened, scope, line.id))
      ) {
        throw new BasketLineAlreadyInRowException(
          'That line is already on the row, so the buy is a settle'
        );
      }

      // A buy is a change of the line, as a settle's is even on a line at
      // zero (`basket-settle.service.ts`), so every event after it carries a
      // newer version than the one a client holds. The quantity stays at 0.
      line.version += 1;
      await manager.getRepository(ListLine).save(line);

      // The change row a settle writes for a buy. The line asks for nothing
      // before and after, so the recorder writes none, as a settle's on a line
      // at zero (plan 0203).
      recorded = await this.changes.bought(
        manager,
        { id: line.listId, zoneId },
        line.id,
        line.quantity,
        line.quantity,
        actor,
        line.unit
      );

      const settlements = manager.getRepository(LineSettlement);
      const settlement = await settlements.save(
        settlements.create({
          lineId: line.id,
          listId: line.listId,
          itemId,
          outcome: SettlementOutcome.BOUGHT,
          quantity,
          unit: line.unit ?? 'UNIT',
          settledByUserId: null,
          settledByParticipantId: opened.participant.id,
          settledAt: new Date(),
          revertedAt: null,
          revertedByParticipantId: null,
          basketId: opened.basket.id,
          ...paid,
          itemSnapshot,
          replacesSettlementId: null,
        })
      );

      announcement = {
        zoneId,
        listId: line.listId,
        line,
        settlement,
        items: await zoneLineItemSet(manager, line.id),
        settlementSummary: {
          boughtCount: await settlements.count({
            where: {
              lineId: line.id,
              outcome: SettlementOutcome.BOUGHT,
              revertedAt: IsNull(),
            },
          }),
          lastOutcome: SettlementOutcome.BOUGHT,
        },
      };
      const claims = await this.claims.claimsOf([line.id], manager);
      announcement.claim = claims.get(line.id) ?? NO_LINE_CLAIM;
    });

    const done = announcement as ZoneAnnouncement | undefined;
    if (!done) {
      // Unreachable: the transaction either set it or threw.
      throw new NotFoundException('Line not found');
    }
    const made = created as ListLine | null;
    if (made !== null && prepared !== null) {
      // The `line.added` of any added line, first, so a client meets the line
      // before the buy on it.
      await this.lines.announceLineAtZero(prepared, made);
    }
    this.events.emit(
      RealtimeEvent.LineSettled,
      done.zoneId,
      {
        line: toLineView(
          done.line,
          done.items,
          done.settlementSummary,
          done.claim ?? NO_LINE_CLAIM
        ),
        settlement: toLineSettlementView(done.settlement),
      },
      done.listId
    );
    opened.announceLinesMoved([
      { listId: done.listId, lineId: done.line.id, recorded },
    ]);
    // The line asks for nothing, which is a line that has left the basket in
    // the sense a claim means (plan 0052, section 3.3), as after a settle.
    await this.claims.announceReleased([
      { zoneId: done.zoneId, listId: done.listId, lineId: done.line.id },
    ]);

    return opened.result([req.rowKey, done.line.id]);
  }

  /**
   * The line the request named, locked, on the target list and holding the
   * product. A deleted or rejected line, or one of another list, is the one
   * "Line not found", so the route says nothing about lines elsewhere.
   */
  private async lockNamedLine(
    manager: EntityManager,
    req: BuyForListBasketRequest,
    itemId: string
  ): Promise<ListLine> {
    const line = await manager.getRepository(ListLine).findOne({
      where: { id: req.lineId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !line ||
      line.deletedAt !== null ||
      line.listId !== req.targetListId ||
      line.approvalStatus === LineApprovalStatus.REJECTED
    ) {
      throw new NotFoundException('Line not found');
    }
    const holds = await manager
      .getRepository(ListLineItem)
      .count({ where: { lineId: line.id, itemId } });
    if (holds === 0) {
      throw new ValidationException('lineId does not hold the row product', {
        messageArgs: { field: 'lineId' },
      });
    }
    return line;
  }
}

/**
 * What a line made here is called: the product's name in the actor's
 * language, else in any language catalog holds, as the gateway read it.
 * Never the text of the row's line or of another list's line (plan 0273,
 * amended on 2026-11-22): one household may have typed it, and it must not
 * reach another household's list. Null when catalog named the product in no
 * language, and then a line that has to be made answers
 * `basket_product_has_no_name`.
 */
function nameOf(req: BuyForListBasketRequest): string | null {
  const sent = typeof req.content === 'string' ? req.content.trim() : '';
  return sent || null;
}

/** A whole number of units from 1 to {@link LINE_QUANTITY_MAX}. */
function validQuantity(quantity: unknown): number {
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > LINE_QUANTITY_MAX
  ) {
    throw new ValidationException('quantity must be a positive whole number', {
      messageArgs: { field: 'quantity' },
    });
  }
  return quantity;
}

/**
 * Whether the basket draws this line now, by the statement the resolver and
 * the read draw with, run on the caller's connection (plan 0201, section 4).
 */
async function isEntryOf(
  manager: EntityManager,
  opened: OpenBasketWrite,
  scope: BasketScope,
  lineId: string
): Promise<boolean> {
  const rows = await manager.query<unknown[]>(COVERED_LINES_BY_ID_SQL, [
    [...opened.coveredListIds],
    opened.basket.id,
    scope.startedAt,
    scope.enabled,
    elsewhereGapOf(opened.basket),
    [lineId],
  ]);
  return rows.length > 0;
}
