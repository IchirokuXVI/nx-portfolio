import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  NO_LINE_CLAIM,
  RealtimeEvent,
  SettlementOutcome,
  type BasketRowResult,
  type RevertBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  StaleQuantityException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, IsNull, MoreThanOrEqual } from 'typeorm';
import { LineSettlement, ListLine } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineClaimService } from '../baskets/line-claim.service';
import { toLineSettlementView, toLineView } from '../lists/list.mappers';
import { boughtOfRow, lockEntries } from './basket-row-resolver';
import {
  zoneLineItemSet,
  type ZoneAnnouncement,
} from './basket-settle.service';
import {
  BasketWriteContext,
  type OpenBasketWrite,
} from './basket-write.context';

/**
 * Taking part of a row back (plan 0136, section 5.2).
 *
 * It replaces three gestures at once: the reopen of a whole basket line, the
 * raise half of `setOutstanding`, and the lowering of what one list got. All
 * three were the same operation aimed at different things, and the two targets
 * here are what is left once the basket line they were aimed through is gone.
 *
 * ## A settlement is an append, and a revert does not delete one
 *
 * The row stays, marked, because "somebody said they got this and then took it
 * back" is a truer history than a gap (plan 0054, section 3.3).
 *
 * ## The units go back by addition
 *
 * Never by restoring a remembered number. The line's current value is whatever
 * else has happened to it since, so an edit or another basket's settle in
 * between is not this call's to undo.
 *
 * ## The owner's `WRITE` holds by construction
 *
 * The entries come from a coverage computed for this request, which closes the
 * hole the audit found in `basket-reopen.service.ts` and which plan 0131
 * patched with a check: a list the owner has lost is not in the row, so no walk
 * can put units on it.
 */
@Injectable()
export class BasketRevertService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: BasketWriteContext,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  async revert(req: RevertBasketRowRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new BasketFinishedException(
        'This basket is finished, so nothing in it can be taken back'
      );
    }

    const row = await opened.row(req.rowKey);
    if (req.target === 'UNITS') {
      if (!Number.isInteger(req.units) || req.units <= 0) {
        throw new ValidationException('units must be a positive whole number', {
          messageArgs: { field: 'units' },
        });
      }
      const held = boughtOfRow(row);
      if (held !== req.from) {
        throw new StaleQuantityException(
          'Somebody else changed this while you were looking at it',
          { messageArgs: { current: held } }
        );
      }
    }

    const announcements: ZoneAnnouncement[] = [];
    /** Entries whose line was deleted since, so no units went back. */
    let skippedCount = 0;

    await this.dataSource.transaction(async (manager) => {
      const zoneLines = manager.getRepository(ListLine);
      const settlements = manager.getRepository(LineSettlement);
      const now = new Date();

      const locked = await lockEntries(manager, row);
      skippedCount = row.entries.length - locked.size;

      const lineIds = row.entries.map((entry) => entry.lineId);
      const standing = await settlements.find({
        where: {
          basketId: opened.basket.id,
          lineId: In(lineIds),
          revertedAt: IsNull(),
          // The same scope the read counts in, so a `LIVE` basket cannot take
          // back a purchase from a session that is over and that its own rows
          // never showed.
          ...(row.scope.startedAt
            ? { settledAt: MoreThanOrEqual(row.scope.startedAt) }
            : {}),
          ...(req.target === 'UNITS'
            ? { outcome: SettlementOutcome.BOUGHT }
            : { outcome: SettlementOutcome.NOT_AVAILABLE }),
        },
        // Newest first, which is the order a revert walks in: the last thing
        // somebody said is the first thing they take back.
        order: { settledAt: 'DESC', id: 'DESC' },
      });

      /** How many units go back onto each zone line. */
      const restored = new Map<string, number>();
      const touched = new Map<string, LineSettlement>();
      const mark = async (rowToMark: LineSettlement): Promise<void> => {
        rowToMark.revertedAt = now;
        rowToMark.revertedByParticipantId = opened.participant.id;
        await settlements.save(rowToMark);
        const lineId = rowToMark.lineId as string;
        if (!touched.has(lineId)) {
          touched.set(lineId, rowToMark);
        }
      };

      if (req.target === 'CLOSE') {
        // **The newest close act**, which is the rows sharing its `settledAt`:
        // one `NOT_AVAILABLE` settle writes a row per entry, so they were one
        // gesture and they go back as one. A close holds no units, so none of
        // the arithmetic plan 0104 section 3.3 needed exists any more.
        const newest = standing[0];
        if (newest) {
          const at = newest.settledAt.getTime();
          for (const candidate of standing) {
            if (candidate.settledAt.getTime() === at) {
              await mark(candidate);
            }
          }
        }
      } else {
        let need = req.units;
        for (const candidate of standing) {
          if (need <= 0) {
            break;
          }
          const take = Math.min(need, candidate.quantity);
          await mark(candidate);
          if (take < candidate.quantity) {
            // Plan 0104 section 3.2: the original is reverted in full and what
            // still stands is appended as an ordinary settlement, carrying the
            // buyer, the product, the line, the basket and the time of the
            // purchase it came out of.
            //
            // `settledAt` is **copied and not restamped**, because it is the
            // time the shopping happened and that has not changed.
            await settlements.save(
              settlements.create({
                lineId: candidate.lineId,
                listId: candidate.listId,
                itemId: candidate.itemId,
                outcome: candidate.outcome,
                quantity: candidate.quantity - take,
                settledByUserId: candidate.settledByUserId,
                settledByParticipantId: candidate.settledByParticipantId,
                settledAt: candidate.settledAt,
                revertedAt: null,
                revertedByParticipantId: null,
                basketId: candidate.basketId,
                // All four price columns, copied (plan 0143, section 4.3). A
                // reverted row keeps its price because it is history, and the
                // half that still stands keeps it because it is still the price
                // that was paid for those units. This is the second reason the
                // column is a price per unit: a total would have to be split
                // here, and a split total is a price nobody paid.
                pricePaidCents: candidate.pricePaidCents,
                pricePaidCurrency: candidate.pricePaidCurrency,
                priceScopeId: candidate.priceScopeId,
                supermarketLocationId: candidate.supermarketLocationId,
                // The chain goes with the shop it names (plan 0163).
                supermarketId: candidate.supermarketId,
              })
            );
          }
          const lineId = candidate.lineId as string;
          restored.set(lineId, (restored.get(lineId) ?? 0) + take);
          need -= take;
        }
      }

      // The walk ran newest first, so the households hear about the purchases
      // in the order they were **made**, which is the order a settle announces
      // in and is what keeps a revert and a settle indistinguishable from
      // outside.
      for (const [lineId, settlement] of [...touched].reverse()) {
        const zoneLine = locked.get(lineId);
        if (!zoneLine) {
          // The line was soft deleted since (plan 0132). Its settlements are
          // still marked, because the purchase was still taken back, and the
          // caller is told something did not land.
          skippedCount += 1;
          continue;
        }
        const units = restored.get(lineId) ?? 0;
        if (units > 0) {
          zoneLine.quantity += units;
          zoneLine.version += 1;
          await zoneLines.save(zoneLine);
        }
        announcements.push({
          zoneId: opened.zoneOf(zoneLine.listId),
          listId: zoneLine.listId,
          line: zoneLine,
          settlement,
          items: await zoneLineItemSet(manager, zoneLine.id),
          // Counted after the reverts are saved, so the rows just marked are
          // out of it, and the outcome is read rather than assumed: this call
          // removes settlements, so what stands afterwards may be nothing.
          settlementSummary: {
            boughtCount: await settlements.count({
              where: {
                lineId: zoneLine.id,
                outcome: SettlementOutcome.BOUGHT,
                revertedAt: IsNull(),
              },
            }),
            lastOutcome:
              (
                await settlements.findOne({
                  where: { lineId: zoneLine.id, revertedAt: IsNull() },
                  order: { settledAt: 'DESC', id: 'DESC' },
                })
              )?.outcome ?? null,
          },
        });
      }

      const claims = await this.claims.claimsOf(
        announcements.map((entry) => entry.line.id),
        manager
      );
      for (const entry of announcements) {
        entry.claim = claims.get(entry.line.id) ?? NO_LINE_CLAIM;
      }
    });

    for (const announcement of announcements) {
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

    return this.answer(opened, req.rowKey, announcements, skippedCount);
  }

  /**
   * The event, the claim and the row.
   *
   * A revert puts units back, so a line that was released may be claimed again.
   * `announceReleased` answers that from the derivation rather than from the
   * transition, so it says nothing when nothing changed and it is the right call
   * in both directions.
   */
  private async answer(
    opened: OpenBasketWrite,
    rowKey: string,
    announcements: readonly ZoneAnnouncement[],
    skippedCount: number
  ): Promise<BasketRowResult> {
    const lineIds = announcements.map((entry) => entry.line.id);
    await opened.announceLinesChanged(
      announcements.map((entry) => ({
        listId: entry.listId,
        lineId: entry.line.id,
      }))
    );
    await this.claims.announceReleased(
      announcements.map((entry) => ({
        zoneId: entry.zoneId,
        listId: entry.listId,
        lineId: entry.line.id,
      }))
    );
    const result = await opened.result(lineIds, rowKey);
    return skippedCount > 0 ? { ...result, skippedCount } : result;
  }
}
