import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  ParticipantKind,
  SettlementOutcome,
  type BasketRowResult,
  type BasketScopePrice,
  type BasketTripBuys,
  type ChangeBasketLinesProductRequest,
  type ListPermission,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  ForbiddenException,
  isUuid,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  In,
  IsNull,
  MoreThanOrEqual,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import { LineSettlement, type ShoppingList } from '../entities';
import { actorOf } from '../lists/changes/line-change.recorder';
import { LineService, type WrittenLine } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import {
  itemSnapshotColumn,
  paidColumns,
  type SettlementPaidColumns,
} from '../lists/settlement-paid';
import { lockEntries, type BasketRow } from './basket-row-resolver';
import { BasketWriteContext } from './basket-write.context';

/**
 * Changing the product of lines from the basket (plan 0202, section 3).
 *
 * Somebody at the shelf took another product than the one the row shows. This
 * is the write that says so, and it does two things in one transaction.
 *
 * ## It rewrites the buys of the trip
 *
 * A line counts as the product of its latest standing buy in the trip (plan
 * 0201, section 1). A line that was already bought in this trip thus keeps
 * saying the old product, whatever the line page says. So every standing buy of
 * the named lines through this basket in its trip is corrected.
 *
 * **A settlement is never edited and never deleted.** The old row gets
 * `revertedAt`, and a new row is written beside it that names it in
 * `replacesSettlementId`. The new row copies the line, the list, the basket,
 * the quantity, the person and `settledAt`, so:
 *
 * - **No quantity moves.** The line is not written, no unit goes back, and by
 *   plan 0203 section 1 no change row is written.
 * - **Every sum reads as before.** The read of a basket, the outside buys of
 *   another basket and the session of a `LIVE` basket all count standing rows
 *   by `settledAt`. One standing row with one quantity at one moment went, and
 *   one came.
 * - **The order of the buys does not change**, so the latest buy of the line is
 *   still its latest buy and "they had none" after it still wins.
 *
 * ## The price is the gateway's
 *
 * Core reads no price. The gateway asked where those buys were priced
 * ({@link tripBuysOf}), read what the new product costs at each of those
 * scopes, and sent the answers. A new row keeps the scope, the shop and the
 * chain of the row it replaces, because where the person stood did not change,
 * and takes the price of the new product at that scope, or none.
 *
 * ## It writes the line when the change is kept
 *
 * With `keep` the product joins the products of the line and becomes its
 * favourite, through `LineService`, so the permissions, the approval rule, the
 * change row and the events are the line page's own. That edit is authorized
 * by the **actor**, never the owner: it changes what a household's list says.
 *
 * Without `keep` the change holds for this trip alone. It lives in the buys,
 * and a line with no buy yet has nowhere to hold it: the route then writes
 * nothing, and the page holds the choice on the device until the first buy
 * (velista plan 0140).
 */
@Injectable()
export class BasketProductChangeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: BasketWriteContext,
    private readonly lines: LineService,
    private readonly listAccess: ListAccessService
  ) {}

  async change(req: ChangeBasketLinesProductRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new BasketFinishedException(
        'This basket is finished, so the product of its lines cannot change'
      );
    }
    const userId = opened.participant.userId;
    if (opened.participant.kind === ParticipantKind.GUEST || !userId) {
      // Refused before anything is read. A guest settles what the row shows
      // and cannot say that a household bought another product.
      throw new ForbiddenException(
        'Only people with an account can change the product of a line'
      );
    }
    if (!isUuid(req.itemId)) {
      throw new ValidationException('itemId must be a valid item reference', {
        messageArgs: { field: 'itemId' },
      });
    }
    if (typeof req.keep !== 'boolean') {
      throw new ValidationException('keep must be true or false', {
        messageArgs: { field: 'keep' },
      });
    }
    // Checked before the transaction opens, like the price of a settle: a
    // malformed message is refused with nothing locked.
    const snapshot = itemSnapshotColumn(req.itemSnapshot);
    const prices = pricesByScope(req.prices);
    const unscoped = paidColumns(req.paid, SettlementOutcome.BOUGHT);

    // The named lines, each a row of the basket, or "Row not found" for the
    // whole write (plan 0201, section 4). The route has no row key, and any of
    // the named lines is one.
    const lineIds = req.lineIds ?? [];
    const row = await opened.row(lineIds[0] ?? '', lineIds);

    // The actor's own standing on each list, read before the transaction
    // because the access service draws its own connections (plan 0130, section
    // 13). A list the actor is no member of is refused here, with `forbidden`.
    const lists = new Map<string, ListAccess>();
    if (req.keep) {
      for (const listId of new Set(row.entries.map((entry) => entry.listId))) {
        const { list, permissions } = await this.listAccess.resolve(
          listId,
          userId
        );
        lists.set(listId, { list, permissions });
      }
    }

    const actor = actorOf({ via: opened.via() });
    /** The lines whose buys were rewritten, by line id. */
    const rewritten = new Map<string, string>();
    const kept: { list: ShoppingList; written: WrittenLine }[] = [];

    await this.dataSource.transaction(async (manager) => {
      const locked = await lockEntries(manager, row);

      for (const settlement of await this.standingBuys(manager, opened, row)) {
        const line = locked.get(settlement.lineId);
        if (!line || settlement.itemId === req.itemId) {
          // A line deleted since, or a buy that already names the product: a
          // second press of the same change writes nothing.
          continue;
        }
        await this.replace(manager, settlement, {
          itemId: req.itemId,
          itemSnapshot: snapshot,
          participantId: opened.participant.id,
          paid: priceOf(settlement, prices, unscoped),
        });
        rewritten.set(line.id, line.listId);
      }

      if (!req.keep) {
        return;
      }
      // In the order the lock took them, which is the id.
      for (const line of locked.values()) {
        const access = lists.get(line.listId);
        if (!access) {
          continue;
        }
        const written = await this.lines.keepProductWithin(
          manager,
          line,
          access.list,
          req.itemId,
          access.permissions,
          actor
        );
        if (written) {
          kept.push({ list: access.list, written });
        }
      }
    });

    // After the commit. A kept line is announced as the edit it was: the zone
    // hears `line.updated`, and every basket that covers the list reads again.
    const announced = new Set<string>();
    for (const { list, written } of kept) {
      this.lines.announceKept(list, written);
      announced.add(written.line.id);
    }
    // A rewrite alone changed what **this** basket reads and nothing else: the
    // product its lines count as. The other baskets count the same units as
    // bought elsewhere, before and after. So this basket alone is told, with
    // the entries as it reads them now, and `tripItemId` in each says the new
    // product. A device that holds the line in the row of another product
    // reads the basket again (plan 0204, section 7).
    opened.announceBasketMoved(
      [...rewritten]
        .filter(([lineId]) => !announced.has(lineId))
        .map(([lineId, listId]) => ({ lineId, listId, recorded: false }))
    );

    return opened.result(row.entries.map((entry) => entry.lineId));
  }

  /**
   * Where the buys a change would rewrite were priced, for the gateway (plan
   * 0202, section 3).
   *
   * The same rows {@link change} rewrites, read with no lock: the gateway reads
   * a price for each scope before the write, and a buy made in between keeps
   * its scope and gets no price, which is an ordinary answer.
   */
  async tripBuysOf(
    opened: BuysScope,
    row: BasketRow
  ): Promise<BasketTripBuys> {
    const buys = await this.standingBuys(this.dataSource.manager, opened, row);
    const scopes = new Set<string>();
    let unscoped = false;
    for (const buy of buys) {
      if (buy.priceScopeId) {
        scopes.add(buy.priceScopeId);
      } else {
        unscoped = true;
      }
    }
    return { priceScopeIds: [...scopes], unscoped };
  }

  /**
   * The standing buys of the named lines through this basket in its trip,
   * oldest first.
   *
   * The scope is the read's own (plan 0136, section 3.1): the current session
   * of a `LIVE` basket, or the whole life of a `GENERATED` one. A `LIVE`
   * basket with no session going has no trip, so it has no buy to rewrite, and
   * yesterday's shop is not corrected from today's screen.
   */
  private async standingBuys(
    manager: EntityManager,
    opened: BuysScope,
    row: BasketRow
  ): Promise<LineSettlement[]> {
    if (!row.scope.enabled) {
      return [];
    }
    const where: FindOptionsWhere<LineSettlement> = {
      basketId: opened.basket.id,
      lineId: In(row.entries.map((entry) => entry.lineId)),
      outcome: SettlementOutcome.BOUGHT,
      revertedAt: IsNull(),
      ...(row.scope.startedAt
        ? { settledAt: MoreThanOrEqual(row.scope.startedAt) }
        : {}),
    };
    return manager.getRepository(LineSettlement).find({
      where,
      order: { settledAt: 'ASC', id: 'ASC' },
    });
  }

  /** Mark one buy replaced, and write the row that stands in for it. */
  private async replace(
    manager: EntityManager,
    old: LineSettlement,
    next: {
      itemId: string;
      itemSnapshot: LineSettlement['itemSnapshot'];
      participantId: string;
      paid: SettlementPaidColumns;
    }
  ): Promise<void> {
    const settlements = manager.getRepository(LineSettlement);
    old.revertedAt = new Date();
    // `ck_line_settlements_revert` asks for a participant beside the time. It
    // is the person who made the correction, as it is the person who took a
    // buy back: in both cases they are who ended the row.
    old.revertedByParticipantId = next.participantId;
    await settlements.save(old);
    await settlements.save(
      settlements.create({
        lineId: old.lineId,
        listId: old.listId,
        itemId: next.itemId,
        outcome: old.outcome,
        // The units, the buyer and the moment are the purchase, and the
        // purchase did not change. `settledAt` is copied and not restamped,
        // as a revert that splits a row copies it (plan 0104, section 3.2).
        quantity: old.quantity,
        settledByUserId: old.settledByUserId,
        settledByParticipantId: old.settledByParticipantId,
        settledAt: old.settledAt,
        revertedAt: null,
        revertedByParticipantId: null,
        basketId: old.basketId,
        ...next.paid,
        itemSnapshot: next.itemSnapshot,
        replacesSettlementId: old.id,
      })
    );
  }
}

/** What {@link BasketProductChangeService.tripBuysOf} needs of an open write. */
interface BuysScope {
  basket: { id: string };
}

/** A covered list, and what the actor may do on it. */
interface ListAccess {
  list: ShoppingList;
  permissions: ReadonlySet<ListPermission>;
}

/**
 * The prices the gateway read, by scope, with their shape checked.
 *
 * Refused and not dropped when malformed, for the reason `paidColumns` gives:
 * it is a bug in whoever built the message.
 */
function pricesByScope(
  prices: readonly BasketScopePrice[] | undefined
): Map<string, BasketScopePrice> {
  const byScope = new Map<string, BasketScopePrice>();
  for (const price of prices ?? []) {
    if (
      !isUuid(price.priceScopeId) ||
      !Number.isInteger(price.pricePaidCents) ||
      price.pricePaidCents < 0 ||
      !/^[A-Z]{3}$/.test(price.pricePaidCurrency)
    ) {
      throw new ValidationException('prices must be prices at a scope', {
        messageArgs: { field: 'prices' },
      });
    }
    byScope.set(price.priceScopeId, price);
  }
  return byScope;
}

/**
 * The five price columns of the row that replaces `old`.
 *
 * - **The old row named a scope.** The place is copied: the scope, the shop and
 *   the chain. The price is the new product's at that scope, or none when the
 *   gateway read none there.
 * - **The old row named none.** It then named no shop either
 *   (`ck_line_settlements_location_scope`), and the price is chosen as a
 *   settle chooses one (plan 0202, section 2), which is `unscoped`.
 */
function priceOf(
  old: LineSettlement,
  prices: ReadonlyMap<string, BasketScopePrice>,
  unscoped: SettlementPaidColumns
): SettlementPaidColumns {
  if (old.priceScopeId === null) {
    return unscoped;
  }
  const price = prices.get(old.priceScopeId);
  return {
    priceScopeId: old.priceScopeId,
    supermarketLocationId: old.supermarketLocationId,
    supermarketId: old.supermarketId,
    pricePaidCents: price?.pricePaidCents ?? null,
    pricePaidCurrency: price?.pricePaidCurrency ?? null,
  };
}
