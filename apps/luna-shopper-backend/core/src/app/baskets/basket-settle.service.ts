import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  isOpenBasket,
  LINE_QUANTITY_MAX,
  NO_LINE_CLAIM,
  RealtimeEvent,
  SettlementOutcome,
  type BasketAllocationEntry,
  type BasketRowResult,
  type LineClaim,
  type LineSettlementSummary,
  type SettleBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  BasketFinishedException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, IsNull, Repository, type EntityManager } from 'typeorm';
import {
  Basket,
  LineSettlement,
  ListLine,
  ListLineItem,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineClaimService } from '../baskets/line-claim.service';
import { toLineItemSet, type LineItemSet } from '../lists/line-item-set';
import { toLineSettlementView, toLineView } from '../lists/list.mappers';
import { paidColumns } from '../lists/settlement-paid';
import { leftOf, lockEntries, type BasketRow } from './basket-row-resolver';
import {
  allocateOldestFirst,
  optionIdsOf,
  type BasketEntry,
} from './basket-rows';
import { BasketWriteContext } from './basket-write.context';

/**
 * Recording what happened to a row at the shelf (plan 0136, section 5.1).
 *
 * The one write here that reaches a zone list, and the half plan 0047 was
 * shaped to receive: settling is an **append** rather than a contested update,
 * so there is no version reconciliation and no partial apply, only an allocation
 * and a write.
 *
 * ## The security property, stated where it is implemented
 *
 * **A settle is authorized by the owner's access, never the actor's** (plan
 * 0051, section 6.4). It used to be a check per origin, comparing the owner's
 * standing against a stored provenance row. It is now true **by construction**:
 * the entries come from a coverage computed for this request, and coverage is
 * defined as the lists the owner can write now. A list the owner has lost is not
 * in the row at all, so there is nothing to skip and nothing to report.
 *
 * So a guest can never cause a write anywhere the owner could not have written
 * themselves. The owner delegated shopping, not permission.
 *
 * ## Why the access reads run before the transaction
 *
 * Every repository the access service holds draws its own connection from the
 * pool, so asking it a question from inside a transaction means one request
 * holding two, which deadlocks the pool under load rather than failing honestly
 * (plan 0130, section 13).
 */
@Injectable()
export class BasketSettleService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    private readonly context: BasketWriteContext,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  async settle(req: SettleBasketRowRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      // Its own code rather than a validation failure (plan 0059, section 3.1):
      // a finished trip that still took settlements could write into a
      // household's zone lines days after the shopper went home, from a link
      // shared with somebody who is no longer shopping.
      throw new BasketFinishedException(
        'This basket is finished, so nothing more can be settled in it'
      );
    }

    const row = await opened.row(req.rowKey);
    const itemId = resolvePick(row, req.itemId);
    const units = this.resolveUnits(req, row);
    // The same four values on every row this settle writes, one per entry
    // (plan 0143, section 4.3). Checked here, before the transaction opens,
    // because a malformed message must be refused with nothing locked.
    const paid = paidColumns(req.paid, req.outcome);

    const announcements: ZoneAnnouncement[] = [];
    // The entries this call took to zero or closed, which is what decides
    // between a claim that moved and one that ended (plan 0052, section 3.3).
    const released: BasketEntry[] = [];

    await this.dataSource.transaction(async (manager) => {
      const zoneLines = manager.getRepository(ListLine);
      const settlements = manager.getRepository(LineSettlement);
      const now = new Date();

      const locked = await lockEntries(manager, row);
      // The `from` bargain, checked against **this** read and never against the
      // one before the transaction opened: a gesture whose meaning depends on
      // where it started must be refused rather than reinterpreted when the
      // number moved underneath it.
      const held = [...locked.values()].reduce(
        (sum, line) => sum + line.quantity,
        0
      );
      if (held !== req.from) {
        throw new StaleQuantityException(
          'Somebody else changed this while you were looking at it',
          { messageArgs: { current: held } }
        );
      }
      if (req.outcome === SettlementOutcome.NOT_AVAILABLE && held === 0) {
        // A conflict rather than a validation failure (plan 0054, section 4):
        // the request is well formed and the state refuses it.
        throw new ConflictException('This row is already finished');
      }

      // Only the entries that survived the lock, in the resolver's own order,
      // so the allocation is still oldest first.
      const live = row.entries.filter((entry) => locked.has(entry.lineId));
      const plan = req.allocations?.length
        ? this.allocateByHand(req.allocations, live, locked, units, opened)
        : allocateOldestFirst(
            live.map((entry) => ({
              ...entry,
              // The locked value, not the one read before the transaction.
              quantity: locked.get(entry.lineId)?.quantity ?? 0,
            })),
            units
          );

      for (const [entry, allocated] of plan) {
        const zoneLine = locked.get(entry.lineId);
        if (!zoneLine) {
          continue;
        }
        // `NOT_AVAILABLE` writes a row per entry with no units, which is what
        // makes the indicator of plan 0047 section 5 derivable. `BOUGHT` with a
        // zero allocation writes nothing, because nothing happened to that
        // household.
        if (allocated === 0 && req.outcome === SettlementOutcome.BOUGHT) {
          continue;
        }

        if (req.outcome === SettlementOutcome.BOUGHT && allocated > 0) {
          // Floored at zero, and the settlement keeps what was actually bought
          // (plan 0047, section 4.2).
          zoneLine.quantity = Math.max(0, zoneLine.quantity - allocated);
          zoneLine.version += 1;
          await zoneLines.save(zoneLine);
        }

        const settlement = await settlements.save(
          settlements.create({
            // Both always set now (plan 0136, section 9): a purchase with no
            // line was a waiting settlement, and there is no line without a
            // list any more for one to wait for.
            lineId: zoneLine.id,
            listId: zoneLine.listId,
            itemId,
            outcome: req.outcome,
            quantity: req.outcome === SettlementOutcome.BOUGHT ? allocated : 0,
            // The participant, always, including for the owner
            // (`ck_line_settlements_actor`).
            settledByUserId: null,
            settledByParticipantId: opened.participant.id,
            settledAt: now,
            revertedAt: null,
            revertedByParticipantId: null,
            // What every read asking "which trip was this bought on" uses
            // (plan 0134, section 3).
            basketId: opened.basket.id,
            // What the screen said one of them costs, and where, as the
            // gateway read it as this basket's **owner** (plan 0143). Every
            // entry of the row gets the same four values: it is a price per
            // unit, so it needs no dividing between the households.
            ...paid,
          })
        );

        if (
          zoneLine.quantity === 0 ||
          req.outcome === SettlementOutcome.NOT_AVAILABLE
        ) {
          released.push(entry);
        }

        announcements.push({
          zoneId: opened.zoneOf(zoneLine.listId),
          listId: zoneLine.listId,
          line: zoneLine,
          settlement,
          // Read rather than assumed empty: `toLineView` takes the set as an
          // argument precisely so a line with two products is never reported as
          // a free text line.
          items: await zoneLineItemSet(manager, zoneLine.id),
          // Counted inside the transaction, after the insert, so it includes
          // the row just written. Announcing a zero summary here would take the
          // bought indicator off the household's line at the exact moment
          // somebody bought it (plan 0047, section 5).
          settlementSummary: {
            boughtCount: await settlements.count({
              where: {
                lineId: zoneLine.id,
                outcome: SettlementOutcome.BOUGHT,
                // A settlement somebody took back is excluded from every
                // consumption total (plan 0054, section 3.3).
                revertedAt: IsNull(),
              },
            }),
            lastOutcome: req.outcome,
          },
        });
      }

      // After the lines are saved and still inside the transaction, so the
      // derivation sees the settle that has just happened (plan 0052, section
      // 3.3).
      const claims = await this.claims.claimsOf(
        announcements.map((entry) => entry.line.id),
        manager
      );
      for (const entry of announcements) {
        entry.claim = claims.get(entry.line.id) ?? NO_LINE_CLAIM;
      }
    });

    for (const announcement of announcements) {
      // Each zone list hears the ordinary plan 0047 event, so the household
      // sees the bread was got without learning which basket got it: the
      // payload carries no participant and no basket.
      this.events.emit(
        RealtimeEvent.LineSettled,
        announcement.zoneId,
        {
          line: toLineView(
            announcement.line,
            announcement.items,
            announcement.settlementSummary,
            announcement.claim ?? NO_LINE_CLAIM
          ),
          settlement: toLineSettlementView(announcement.settlement),
        },
        announcement.listId
      );
    }

    await opened.announceLinesChanged(
      announcements.map((entry) => ({
        listId: entry.listId,
        lineId: entry.line.id,
      }))
    );

    // A line taken to zero, or closed, has left this basket in every sense that
    // matters to a zone (plan 0052, section 3.3), so the claim on it goes.
    // Asked of the derivation rather than assumed, because another basket may
    // still be carrying it.
    await this.claims.announceReleased(
      released.map((entry) => ({
        zoneId: opened.zoneOf(entry.listId),
        listId: entry.listId,
        lineId: entry.lineId,
      }))
    );

    return opened.result(
      announcements.map((entry) => entry.line.id),
      req.rowKey
    );
  }

  /**
   * How many units this act settles.
   *
   * `NOT_AVAILABLE` ignores any number it was given, because it is an outcome
   * rather than a quantity, and a caller who sends both has said two things and
   * meant the first.
   *
   * **It is not capped at what the row asks for.** Plan 0047 section 4.2 stands:
   * buying three of a row that says two records three, because the extra unit is
   * real and belongs in the consumption history even though it had no demand to
   * satisfy. The double tap the old cap existed for is caught by `from` instead,
   * since the second tap still names the `left` the first one changed.
   */
  private resolveUnits(req: SettleBasketRowRequest, row: BasketRow): number {
    if (req.outcome === SettlementOutcome.NOT_AVAILABLE) {
      return 0;
    }
    if (req.quantity === undefined) {
      return leftOf(row);
    }
    if (
      !Number.isInteger(req.quantity) ||
      req.quantity <= 0 ||
      req.quantity > LINE_QUANTITY_MAX
    ) {
      throw new ValidationException(
        'quantity must be a positive whole number',
        { messageArgs: { field: 'quantity' } }
      );
    }
    return req.quantity;
  }

  /**
   * The allocation sheet: the same operation with the allocation supplied
   * instead of derived, so it writes the same settlements.
   *
   * **Every `lineId` it names must belong to a list served to the actor.** A
   * reader who was not told which list an entry belongs to cannot be allowed to
   * address one by id, or the sheet would be a way to learn the shape of a
   * household the redaction withheld.
   */
  private allocateByHand(
    allocations: readonly BasketAllocationEntry[],
    entries: readonly BasketEntry[],
    locked: ReadonlyMap<string, ListLine>,
    units: number,
    opened: { servedListIds: ReadonlySet<string> }
  ): Map<BasketEntry, number> {
    const asked = new Map<string, number>();
    for (const entry of allocations) {
      if (!Number.isInteger(entry.quantity) || entry.quantity < 0) {
        throw new ValidationException(
          'each allocation must be a whole number of units',
          { messageArgs: { field: 'allocations' } }
        );
      }
      asked.set(entry.lineId, (asked.get(entry.lineId) ?? 0) + entry.quantity);
    }

    const total = [...asked.values()].reduce((sum, n) => sum + n, 0);
    if (total > units) {
      throw new ValidationException(
        'the allocation adds up to more than was settled',
        { messageArgs: { field: 'allocations' } }
      );
    }

    const plan = new Map<BasketEntry, number>();
    for (const entry of entries) {
      const want = asked.get(entry.lineId);
      if (want === undefined) {
        plan.set(entry, 0);
        continue;
      }
      if (!opened.servedListIds.has(entry.listId)) {
        // Refused whole rather than dropped, and with the same message as a
        // line the row does not hold: the refusal must not distinguish "you may
        // not address this" from "this is not here".
        throw new ValidationException(
          'the allocation names a list this row does not come from',
          { messageArgs: { field: 'allocations' } }
        );
      }
      plan.set(entry, Math.min(want, locked.get(entry.lineId)?.quantity ?? 0));
      asked.delete(entry.lineId);
    }
    if (asked.size > 0) {
      throw new ValidationException(
        'the allocation names a list this row does not come from',
        { messageArgs: { field: 'allocations' } }
      );
    }
    return plan;
  }
}

/**
 * The product this settle records (plan 0047, section 3.2).
 *
 * A swap is only allowed to one of the row's own options, which is what keeps it
 * a gesture at the shelf rather than a way to write an arbitrary catalog id into
 * a household's purchase history.
 *
 * With no `itemId` given, a row offering exactly one product records that one
 * and any other row records null: a row with two options has no pick to guess,
 * and guessing one would put a product in somebody's history that nobody chose.
 */
export function resolvePick(
  row: BasketRow,
  itemId: string | undefined
): string | null {
  const options = optionIdsOf(row.entries);
  if (itemId === undefined) {
    return options.length === 1 ? options[0] : null;
  }
  if (!options.includes(itemId)) {
    throw new ValidationException(
      'That product is not one of this row’s options',
      { messageArgs: { field: 'itemId' } }
    );
  }
  return itemId;
}

/** A zone line's product set, in attachment order (plan 0048, section 1.1). */
export async function zoneLineItemSet(
  manager: EntityManager,
  lineId: string
): Promise<LineItemSet> {
  const rows = await manager.getRepository(ListLineItem).find({
    where: { lineId },
    order: { position: 'ASC', createdAt: 'ASC' },
  });
  return toLineItemSet(rows);
}

/** One zone list's news, held until the transaction commits. */
export interface ZoneAnnouncement {
  zoneId: string;
  listId: string;
  line: ListLine;
  settlement: LineSettlement;
  items: LineItemSet;
  settlementSummary: LineSettlementSummary;
  claim?: LineClaim;
}
