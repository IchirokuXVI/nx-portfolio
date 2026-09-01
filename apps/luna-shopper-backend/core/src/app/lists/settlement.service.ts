import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LINE_QUANTITY_MAX,
  RealtimeEvent,
  SettlementOutcome,
  type LineSettlementPage,
  type LineSettlementResult,
  type LineSettlementView,
  type ListItemSettlementsRequest,
  type ListLineSettlementsRequest,
  type SettleLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, Repository } from 'typeorm';
import { LineSettlement, ListLine, ListLineItem } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ListAccessService } from './list-access.service';
import { toLineSettlementView, toLineView } from './list.mappers';
import { ITEM_SETTLEMENTS_SQL } from './settlement.sql';

/**
 * What a settlement cursor carries: the boundary row's id, and nothing else.
 *
 * Not its `settledAt`, which is the trap the other cursors in core still carry:
 * an ISO timestamp is milliseconds and a `timestamptz` is microseconds, so a
 * token holding the value sits just below the row it names and either repeats it
 * or skips it. Both reads here ask Postgres for the boundary row's own sort key
 * instead, which costs one primary key lookup and cannot drift.
 */
interface SettlementCursor extends Record<string, unknown> {
  id: string;
}

/** Canonical UUID shape, for validating the cross-service catalog `itemId`. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Settling a line, and reading back what was settled (plan 0047).
 *
 * A zone list is a record of what a household keeps rather than a list you tick
 * off, so a line's quantity is the only thing that says whether it is wanted and
 * a trip's outcome lives in `line_settlements`. This service is both halves of
 * that: the write that moves a line and records why, and the two reads every
 * history, indicator and estimate on the line page is computed from.
 *
 * It is separate from `LineService` because the two answer different questions
 * about the same row. Everything there is an edit somebody made to the list;
 * everything here is a report of what happened in a shop, which is why it never
 * reopens an approval, never splits a line and never touches a product set.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(LineSettlement)
    private readonly settlements: Repository<LineSettlement>,
    private readonly listAccess: ListAccessService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Say what happened to one line on a trip (plan 0047, section 4). `DECIDE`.
   *
   * | Outcome | Writes a settlement | Moves the quantity |
   * | --- | --- | --- |
   * | `BOUGHT` | yes, for the units bought | down by that many, floored at 0 |
   * | `NOT_AVAILABLE` | yes, of quantity 0 | no |
   * | skipped | no | no |
   *
   * **Skipping is not a value here.** "I decided not to buy this today" has to
   * leave the line exactly as it was and must not look like it was dealt with, so
   * it is the absence of a call rather than a third outcome.
   *
   * `DECIDE` and not `WRITE`, because this is what `setStatus` was: the flatmate
   * who walks the aisle and says what went in the trolley is exactly the person
   * plan 0036 separated that permission out for, and the same call already moves
   * an approved line's quantity, which nothing below `DECIDE` may do.
   *
   * ## Nothing about it is terminal
   *
   * Asking for three and buying two decrements to one and leaves the line wanted;
   * a second settle later takes it the rest of the way (section 4.1). That is
   * what lets a basket be worked through two shops in one afternoon, and it is
   * the property plan 0051 depends on.
   *
   * ## It never reopens an approval, and it never splits
   *
   * Both are true of an edit and neither is true of this. Approval answers
   * whether the thing belongs on the list, and buying it is not an opinion about
   * that; a quantity a shopper reports is not a request somebody withdrew, so
   * there is no shortfall to preserve as a second line.
   *
   * ## The read is inside the write
   *
   * The row is locked and re-read inside the transaction for the reason
   * `addQuantity` does it: the new quantity is computed from what the row says,
   * so a concurrent settle between the read and the write would vanish with
   * nothing logged and nothing errored. The caller's access is resolved
   * **before** the transaction, because every repository the access service holds
   * draws its own connection from the pool and asking it a question from inside a
   * transaction means one request holding two.
   */
  async settle(req: SettleLineRequest): Promise<LineSettlementResult> {
    const quantity = this.validateSettleQuantity(req);
    this.validateItemId(req.itemId);

    const found = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.requireDecide(found.listId, req.userId);

    const result = await this.dataSource.transaction(async (manager) => {
      const lines = manager.getRepository(ListLine);
      const line = await lines.findOne({
        where: { id: req.lineId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!line) {
        throw new NotFoundException('Line not found');
      }

      const itemIds = await this.itemIdsOf(
        manager.getRepository(ListLineItem),
        line.id
      );
      const itemId = this.resolveItemId(req.itemId, itemIds);

      // Floored at zero, and the settlement keeps what was actually bought
      // (section 4.2): buying three of a line that says two decrements to zero
      // and records three, because the extra unit is real and belongs in the
      // consumption history even though it has no demand to satisfy. A
      // settlement clamped to the outstanding demand would quietly under report
      // what the household goes through.
      const remaining =
        req.outcome === SettlementOutcome.BOUGHT
          ? Math.max(0, line.quantity - quantity)
          : line.quantity;

      if (remaining !== line.quantity) {
        line.quantity = remaining;
        line.version += 1;
        await lines.save(line);
      }

      const repo = manager.getRepository(LineSettlement);
      const settlement = await repo.save(
        repo.create({
          lineId: line.id,
          listId: line.listId,
          itemId,
          outcome: req.outcome,
          quantity,
          settledByUserId: req.userId,
          settledAt: new Date(),
          generatedListLineId: null,
          pricePaidCents: null,
          supermarketLocationId: null,
        })
      );

      return {
        line: toLineView(line, itemIds),
        settlement: toLineSettlementView(settlement),
      };
    });

    // After the commit, as everywhere else in core. It carries both halves so a
    // phone in the shop and a phone at home agree without a refetch (section 8).
    this.events.emit(RealtimeEvent.LineSettled, list.zoneId, result, list.id);
    return result;
  }

  /**
   * One line's own settlements, newest first (plan 0047, section 6.1). `READ`.
   *
   * A settlement is a **zone fact**: what the flat bought and when is exactly the
   * shared knowledge a shared list exists to hold, and a history visible only to
   * whoever happened to do the shopping is useless in the household this product
   * is for (section 3.1). What it never says is which basket a purchase came out
   * of, which {@link toLineSettlementView} is what enforces.
   */
  async listForLine(
    req: ListLineSettlementsRequest
  ): Promise<LineSettlementPage> {
    const line = await this.listAccess.getLine(req.lineId);
    await this.listAccess.requireRead(line.listId, req.userId);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor<SettlementCursor>(req.cursor);

    const qb = this.settlements
      .createQueryBuilder('s')
      .where('s."lineId" = :lineId', { lineId: req.lineId })
      .orderBy('s.settledAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .take(limit + 1);

    if (cursor?.id) {
      // The boundary row's own sort key, read back by id rather than carried in
      // the token: an ISO timestamp in a cursor is milliseconds and a
      // `timestamptz` is microseconds, so a token carrying the value would skip
      // the boundary row on this descending order.
      qb.andWhere(
        `(s."settledAt", s."id") < (SELECT b."settledAt", b."id" FROM "line_settlements" b WHERE b."id" = :cid)`,
        { cid: cursor.id }
      );
    }

    const rows = await qb.getMany();
    return this.page(rows, limit);
  }

  /**
   * One product's settlements across every list the caller can read (plan 0047,
   * section 6.2).
   *
   * Filtered by that access **at request time**, which is the same rule
   * everything else here uses: a zone you have since left takes its history with
   * it. It is keyed on the settlement's own copied `itemId` and never on a join
   * through lines, because a line's product set can change and its past purchases
   * do not move with it (section 3.2).
   *
   * This is what makes "you buy this about every eleven days" a number about a
   * household's consumption rather than a per list fragment. It is deliberately
   * one read beside the line's own rather than merged into it: one is the
   * household's consumption and the other is yours, and a single merged number
   * would be neither.
   */
  async listForItem(
    req: ListItemSettlementsRequest
  ): Promise<LineSettlementPage> {
    if (!UUID_PATTERN.test(req.itemId)) {
      throw new ValidationException('itemId must be a valid item reference', {
        messageArgs: { field: 'itemId' },
      });
    }

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor<SettlementCursor>(req.cursor);

    const rows = await this.settlements.query<SettlementRow[]>(
      ITEM_SETTLEMENTS_SQL,
      [req.itemId, req.userId, cursor?.id ?? null, limit + 1]
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        ...row,
        settledAt: new Date(row.settledAt).toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }

  /** A page of entities, trimmed and cursored the one way both reads do it. */
  private page(rows: LineSettlement[], limit: number): LineSettlementPage {
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toLineSettlementView),
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }

  /**
   * What the settlement records, checked against the outcome it belongs to.
   *
   * `BOUGHT` needs a whole number of units, defaulting to one, because "we got
   * the milk" with no number is one of them. `NOT_AVAILABLE` is always zero and
   * **refuses** a quantity rather than ignoring one: a caller sending "they had
   * none, quantity 3" has misunderstood the call badly enough that silently
   * writing a zero would hide it.
   */
  private validateSettleQuantity(req: SettleLineRequest): number {
    if (req.outcome === SettlementOutcome.NOT_AVAILABLE) {
      if (req.quantity !== undefined && req.quantity !== 0) {
        throw new ValidationException(
          'a line that was not available carries no quantity',
          { messageArgs: { field: 'quantity' } }
        );
      }
      return 0;
    }

    const quantity = req.quantity ?? 1;
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > LINE_QUANTITY_MAX
    ) {
      throw new ValidationException(
        `quantity must be a whole number between 1 and ${LINE_QUANTITY_MAX}`,
        { messageArgs: { field: 'quantity' } }
      );
    }
    return quantity;
  }

  /** The catalog reference is cross service, so only its shape is checked here. */
  private validateItemId(itemId?: string): void {
    if (itemId !== undefined && !UUID_PATTERN.test(itemId)) {
      throw new ValidationException('itemId must be a valid item reference', {
        messageArgs: { field: 'itemId' },
      });
    }
  }

  /**
   * The product this settlement records, copied at settle time (section 3.2).
   *
   * It has to be one of the line's own, because a settlement naming a product the
   * line never stood for would put a purchase into the cross list history of
   * something nobody bought. A line carrying exactly one product needs no
   * argument: there is only one answer and asking every caller to repeat it would
   * make the ordinary settle two round trips. A line carrying several and a
   * caller that did not say records null, which is honest: something was bought
   * and the record does not claim to know which.
   */
  private resolveItemId(
    requested: string | undefined,
    itemIds: readonly string[]
  ): string | null {
    if (requested === undefined) {
      return itemIds.length === 1 ? itemIds[0] : null;
    }
    if (!itemIds.includes(requested)) {
      throw new ValidationException(
        'that product is not one this line stands for',
        { messageArgs: { field: 'itemId' } }
      );
    }
    return requested;
  }

  /** A line's products, in the order they were attached. */
  private async itemIdsOf(
    repo: Repository<ListLineItem>,
    lineId: string
  ): Promise<string[]> {
    const rows = await repo.find({
      where: { lineId },
      order: { position: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => row.itemId);
  }
}

/** One raw row of {@link ITEM_SETTLEMENTS_SQL}, before its date is serialized. */
interface SettlementRow extends Omit<LineSettlementView, 'settledAt'> {
  settledAt: string | Date;
}
