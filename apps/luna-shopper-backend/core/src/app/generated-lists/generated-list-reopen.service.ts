import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  isLiveGeneratedList,
  NO_LINE_CLAIM,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListLineMovedEvent,
  type GeneratedListReopenResult,
  type LineClaim,
  type LineSettlementSummary,
  type ReopenGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ForbiddenException,
  GeneratedListFinishedException,
  NotFoundException,
  StaleQuantityException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  In,
  IsNull,
  Repository,
  type EntityManager,
} from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toLineItemSet, type LineItemSet } from '../lists/line-item-set';
import { toLineSettlementView, toLineView } from '../lists/list.mappers';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { LineClaimService } from './line-claim.service';

/**
 * Taking a purchase back, whether it is one unit or the whole line (plan 0054
 * section 3, generalized by plan 0104 section 3).
 *
 * The reverse of {@link GeneratedListSettleService.settle}, and it is a service
 * of its own for the reason the settle is: it is the other operation on this
 * surface that reaches a zone list, and putting the two in one file would put
 * two transactions and two announcement paths behind one set of injected
 * repositories.
 *
 * ## One implementation, three callers
 *
 * {@link revertUnits} is the arithmetic and {@link reopen} is that method called
 * with everything the line has settled. Plan 0104 gave it two more callers:
 * raising the number on a basket row, and lowering what one list got. There is
 * one implementation because two would disagree about the claim on the day one
 * of them was changed.
 *
 * ## Undoing the settle means undoing three things
 *
 * A settle advances the basket line, appends a settlement per origin, and
 * decrements the origin `ListLine`. Undoing only the first would leave a line
 * outstanding on the basket that the origin lists believe was bought, so all
 * three move together, in one transaction, under the same pessimistic write lock
 * the settle takes on each origin.
 *
 * ## The history is not deleted
 *
 * **A settlement is an append** (plan 0047, section 3), and that does not change
 * here. A reverted row is marked with `revertedAt` and the participant who did
 * it: excluded from every consumption total, still served by the settlement
 * history, because "somebody said they got this and then took it back" is a
 * truer history than a gap.
 *
 * A take back smaller than the row it lands in **splits** the row rather than
 * writing a `revertedQuantity` column onto it (plan 0104, section 3.2). The
 * column loses on the same ground the entity's own comment rejects a negative
 * compensating row: every sum over `quantity` anywhere in core would need a
 * second term, and every one that was not found would be silently wrong. A split
 * leaves those sums correct with no change at all.
 *
 * ## Who may
 *
 * The same authorization the settle has and no more: any live participant of
 * this basket, guests included (section 3.5). A reopen is not a wider act than a
 * settle, it touches exactly the origins this basket line's own settlements
 * touched, and refusing it to the person who just made the mistake would leave
 * the mistake standing. It does not require the all or nothing rule either,
 * because that rule gates naming zone data and this response names nothing.
 */
@Injectable()
export class GeneratedListReopenService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  async reopen(
    req: ReopenGeneratedListLineRequest
  ): Promise<GeneratedListReopenResult> {
    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }
    if (!isLiveGeneratedList(list.status)) {
      // The mirror of the settle's refusal (plan 0059, section 3.2): a reopen
      // writes the zone line and the settlement table exactly as a settle does,
      // in the other direction, and a finished trip does neither.
      throw new GeneratedListFinishedException(
        'This basket is finished, so its lines cannot be reopened'
      );
    }
    const line = await this.lines.findOne({
      where: { id: req.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    const participant = await this.sharing.livePresenceEntry(
      req.participantId,
      list.id
    );
    if (!participant) {
      throw new ForbiddenException('Not a participant of this basket');
    }

    if (line.settledQuantity === 0) {
      // The mirror of the settle's already finished check, and a conflict for
      // the same reason (section 4): the request is well formed and the state
      // refuses it, so the client can say which of the things that can go wrong
      // went wrong.
      throw new ConflictException('This line is already outstanding');
    }

    // Everything this line has settled, which is what makes the whole line
    // reopen a revert of every unit rather than a second implementation of one
    // (plan 0104, section 3.4).
    const reverted = await this.revertUnits(list, line, {
      participantId: req.participantId,
      units: line.settledQuantity,
    });

    // Section 5.2 governs the line's own projection here as everywhere else,
    // even though the act itself does not require it: `origins`, `targetListId`
    // and `origin` name zone data whichever call produced the line.
    const seesZoneData = await this.seesZoneData(req.participantId, list.id);
    const view = await this.generated.basketLineViewFor(line, seesZoneData);

    return { line: view, skippedCount: reverted.skippedCount };
  }

  /**
   * Take **n** units back off this basket line, newest purchase first (plan
   * 0104, section 3.1).
   *
   * Newest first is the rule because the act is an undo: the person raising the
   * number is almost always taking back the thing they just did, and an order
   * that reached for the oldest purchase would take back somebody else's.
   *
   * The caller has already resolved the basket, the line and the participant, so
   * this method takes both entities rather than reading them again. It **mutates
   * the line it is handed** with what it wrote, so the view the caller composes
   * afterwards describes the line as it now stands.
   *
   * ## What a `NOT_AVAILABLE` close is worth
   *
   * A close carries `quantity` zero and closed however many units were
   * outstanding when it was written, so there is no arithmetic that takes one
   * unit back off it and the walk takes the whole close back when it reaches one
   * (section 3.3). How many units that is, is not a column: it is what
   * `settledQuantity` holds above the standing purchases, which is exactly what
   * a close put there. One close act writes a row per origin, so the rows
   * sharing its `settledAt` are taken back together and charged once.
   *
   * That is the one case where the number lands somewhere other than where it
   * was asked for, and it errs toward "not bought", which is the safe direction
   * to be wrong in.
   */
  async revertUnits(
    list: GeneratedList,
    line: GeneratedListLine,
    req: RevertUnitsRequest
  ): Promise<RevertUnitsResult> {
    // Collected inside the transaction and published after it commits, which is
    // the convention everywhere in core: an event for a write that then rolled
    // back is a client showing something that never happened.
    const announcements: ZoneAnnouncement[] = [];
    const skipped: RevertSkip[] = [];
    let taken = 0;
    // Whether the line was finished before this call, which is what decides
    // whether the claim it released comes back (plan 0052, section 3.3).
    let wasFinished = false;

    await this.dataSource.transaction(async (manager) => {
      const zoneLines = manager.getRepository(ListLine);
      const settlements = manager.getRepository(LineSettlement);
      const basketLines = manager.getRepository(GeneratedListLine);
      const now = new Date();

      // Re-read under a write lock, because everything below is computed from
      // what the row says. The `from` bargain of plan 0056 section 3.2 is
      // checked against **this** read and not against the caller's: a gesture
      // whose meaning depends on where it started must never be applied to a
      // number that moved underneath it.
      const locked = await basketLines.findOne({
        where: { id: line.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException('Line not found');
      }
      if (req.expectOutstanding !== undefined) {
        const held = Math.max(0, locked.quantity - locked.settledQuantity);
        if (held !== req.expectOutstanding) {
          throw new StaleQuantityException(
            'This line has moved since you read it',
            { messageArgs: { current: held } }
          );
        }
      }
      wasFinished = locked.settledQuantity >= locked.quantity;

      // Every settlement this call may take back, newest first. Restricted to
      // one origin for plan 0104 section 4, where the number being lowered is
      // what **one list** got: a close belongs to no list's count, which is why
      // that walk is over purchases alone.
      const standing = await settlements.find({
        where: {
          generatedListLineId: line.id,
          revertedAt: IsNull(),
          ...(req.originLineId === undefined
            ? {}
            : {
                lineId: req.originLineId,
                outcome: SettlementOutcome.BOUGHT,
              }),
        },
        order: { settledAt: 'DESC', id: 'DESC' },
      });

      if (req.expectOriginSettled !== undefined) {
        const held = standing.reduce((sum, row) => sum + row.quantity, 0);
        if (held !== req.expectOriginSettled) {
          throw new StaleQuantityException(
            'This line has moved since you read it',
            { messageArgs: { current: held } }
          );
        }
      }

      const bought = standing.reduce(
        (sum, row) =>
          row.outcome === SettlementOutcome.BOUGHT ? sum + row.quantity : sum,
        0
      );
      // What the standing closes hold, which is the rest of `settledQuantity`.
      // Zero for a per origin walk, which sees no close at all.
      let closed =
        req.originLineId === undefined
          ? Math.max(0, locked.settledQuantity - bought)
          : 0;

      const byOrigin = new Map<string, RevertedOrigin>();
      const mark = async (row: LineSettlement): Promise<void> => {
        row.revertedAt = now;
        row.revertedByParticipantId = req.participantId;
        await settlements.save(row);
      };
      const record = (row: LineSettlement, units: number): void => {
        if (row.lineId === null) {
          // **A waiting purchase is reverted and nothing else** (plan 0093,
          // section 4). A settle made before this line reached any list wrote a
          // row attached to the basket line alone, and taking that back is one
          // column: there is no zone line to restore units to, no list to name
          // and no household to tell.
          return;
        }
        const held = byOrigin.get(row.lineId);
        if (held) {
          held.rows.push(row);
          held.restored += units;
          return;
        }
        byOrigin.set(row.lineId, { rows: [row], restored: units });
      };

      let need = req.units;
      // Whether the walk reached the end of the standing rows and took all of
      // each, which is what a whole line reopen does and what lets it land on
      // zero rather than on arithmetic (see the write below).
      let consumedEverything = true;
      for (const entry of revertEntries(standing)) {
        if (need <= 0) {
          consumedEverything = false;
          break;
        }

        if (entry.close) {
          // Whole, always (section 3.3), and charged once for the act rather
          // than once per origin it was written against.
          for (const row of entry.rows) {
            await mark(row);
            // No units go back onto the zone line: a close moved none. The row
            // is marked all the same, because the indicator plan 0047 section 5
            // derives has to stop saying the shop had none.
            record(row, 0);
          }
          taken += closed;
          need -= closed;
          closed = 0;
          continue;
        }

        const [row] = entry.rows;
        const take = Math.min(need, row.quantity);
        await mark(row);
        if (take < row.quantity) {
          // Section 3.2: the original is reverted in full and what still stands
          // is appended as an ordinary settlement, carrying the buyer, the
          // product, the origin and the time of the purchase it came out of.
          //
          // `settledAt` is **copied and not restamped**, because it is the time
          // the shopping happened and that has not changed.
          await settlements.save(
            settlements.create({
              lineId: row.lineId,
              listId: row.listId,
              itemId: row.itemId,
              outcome: row.outcome,
              quantity: row.quantity - take,
              settledByUserId: row.settledByUserId,
              settledByParticipantId: row.settledByParticipantId,
              settledAt: row.settledAt,
              revertedAt: null,
              revertedByParticipantId: null,
              generatedListLineId: row.generatedListLineId,
              pricePaidCents: row.pricePaidCents,
              supermarketLocationId: row.supermarketLocationId,
            })
          );
          consumedEverything = false;
        }
        record(row, take);
        taken += take;
        need -= take;
      }

      // The room each touched list's news goes to, in one query rather than one
      // per settlement. The settle path takes this off the provenance row it is
      // already holding; this walk reads settlements, which record the list they
      // landed on and not the zone, so it is read here instead.
      const zones = await this.zonesOf(
        manager,
        [...byOrigin.values()].map((held) => held.rows[0].listId as string)
      );

      // The walk runs newest first, so the map is in the order the purchases were
      // undone. The households hear about them in the order they were **made**,
      // which is the same order a settle announces in and is what keeps a reopen
      // and a raise to the top of one line indistinguishable from outside.
      for (const [originLineId, held] of [...byOrigin].reverse()) {
        const zoneLine = await zoneLines.findOne({
          where: { id: originLineId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!zoneLine) {
          // The origin line was deleted, so there is nothing to put back. Its
          // settlements are still marked reverted, and the caller is told
          // something did not land, the way plan 0051 section 6.4 reports a skip
          // and for the same reason.
          skipped.push({
            lineId: originLineId,
            listId: held.rows[0].listId as string,
          });
          continue;
        }

        if (held.restored > 0) {
          // The units this basket took off are the units this basket puts back.
          // The line's current value is whatever else has happened to it since,
          // which is why this adds rather than restoring a remembered number: an
          // edit or another basket's settle in between is not this call's to
          // undo.
          zoneLine.quantity += held.restored;
          zoneLine.version += 1;
          await zoneLines.save(zoneLine);
        }

        const zoneId = zones.get(zoneLine.listId);
        if (!zoneId) {
          // The units are back and the settlements are marked; only the
          // household cannot be told, because the list they would be told
          // through is gone. Not a skip: a skip is an origin this call could not
          // put units on, and this one it did.
          continue;
        }

        announcements.push({
          zoneId,
          listId: zoneLine.listId,
          line: zoneLine,
          // The newest of the rows this call took back, which is the one a
          // reader is holding: the event carries one settlement, and the others
          // are older states of the same line's history. The walk is newest
          // first, so it is the one it reached first.
          settlement: held.rows[0],
          items: await this.zoneLineItemSet(manager, zoneLine.id),
          // Counted after the reverts are saved, so the rows just marked are out
          // of it, and the most recent outcome is read rather than assumed: this
          // call removes settlements, so what is left is whatever stood before
          // the ones it undid, which may be nothing at all.
          settlementSummary: await this.summaryOf(settlements, zoneLine.id),
        });
      }

      // A walk that took every standing row whole has taken back everything this
      // basket line ever settled, so the line lands on zero rather than on
      // `settledQuantity - taken`. The two agree in every state the settle can
      // produce; they differ only if the column ever drifts above the rows it is
      // a sum of, and a whole line reopen has to reach zero either way.
      locked.settledQuantity =
        consumedEverything && req.originLineId === undefined
          ? 0
          : Math.max(0, locked.settledQuantity - taken);
      locked.lastEditedByParticipantId = req.participantId;
      locked.lastEditedAt = now;
      await basketLines.save(locked);

      // Carried back onto the row this call is holding, so the view the caller
      // composes after the transaction describes the line as it now stands.
      line.quantity = locked.quantity;
      line.settledQuantity = locked.settledQuantity;
      line.lastEditedByParticipantId = locked.lastEditedByParticipantId;
      line.lastEditedAt = locked.lastEditedAt;

      // After the basket line is saved and still inside the transaction, so the
      // derivation sees the line it has just taken back (plan 0052,
      // section 3.3): a line that is outstanding again claims its origins again,
      // and the event announcing the restored quantity carries that.
      const claims = await this.claims.claimsOf(
        announcements.map((entry) => entry.line.id),
        manager
      );
      for (const entry of announcements) {
        entry.claim = claims.get(entry.line.id) ?? NO_LINE_CLAIM;
      }
    });

    for (const announcement of announcements) {
      // The event the household already handles for a line whose numbers moved
      // (section 3.6). A new event type would mean every list screen in the
      // product needing a case for it before any of them could show the right
      // number.
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

    // The basket's own room, and the owner's sessions beside it, which is the
    // ordinary line update they hear after a settle (section 3.6). The owner is
    // usually not in the room: they are at home while somebody else shops, and
    // velista 0045's card counts settled lines.
    const announcement: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineSettled,
      list.id,
      announcement
    );
    this.events.emitToUsers(
      RealtimeEvent.GeneratedListLineSettled,
      [list.ownerUserId],
      announcement
    );

    // A line that was finished released its origins (plan 0052, section 3.3),
    // and a line that is outstanding again takes them back. Announced for every
    // origin rather than only the ones a settlement touched, because the release
    // was over every origin too.
    if (wasFinished && line.settledQuantity < line.quantity) {
      this.claims.announce(
        true,
        list.ownerUserId,
        await this.claims.refsOfBasketLine(line.id)
      );
    }

    return { skippedCount: skipped.length, skipped, taken };
  }

  /**
   * Which zone each of these lists belongs to, for the rooms their news goes to.
   *
   * One query for the whole call rather than a lookup per settlement, and a list
   * that is not there any more simply has no entry: the answer says which rooms
   * can be addressed rather than asserting that all of them can.
   */
  private async zonesOf(
    manager: EntityManager,
    listIds: readonly string[]
  ): Promise<Map<string, string>> {
    const ids = [...new Set(listIds)];
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await manager.getRepository(ShoppingList).find({
      where: { id: In(ids) },
    });
    return new Map(rows.map((row) => [row.id, row.zoneId]));
  }

  /**
   * The zone line's two indicators as this revert leaves them (plan 0047,
   * section 5).
   *
   * Both are read, where the settle path could assume the outcome it had just
   * written. A revert takes rows away instead, so what is left is whatever stood
   * before the one it undid, and that may be nothing at all: a line bought once
   * and reopened goes back to never bought, which is exactly the caption the
   * household should see.
   */
  private async summaryOf(
    settlements: Repository<LineSettlement>,
    lineId: string
  ): Promise<LineSettlementSummary> {
    const boughtCount = await settlements.count({
      where: {
        lineId,
        outcome: SettlementOutcome.BOUGHT,
        revertedAt: IsNull(),
      },
    });
    const latest = await settlements.findOne({
      where: { lineId, revertedAt: IsNull() },
      order: { settledAt: 'DESC', id: 'DESC' },
    });
    return { boughtCount, lastOutcome: latest?.outcome ?? null };
  }

  /**
   * Whether this actor may be told which lists this line came from.
   *
   * Asked of core's own access tables at request time (plan 0051, section 5.2),
   * never taken from the request: the gateway computes the same value for its
   * own guard, but a value that travelled through a message is a value a future
   * caller could send.
   */
  private async seesZoneData(
    participantId: string,
    generatedListId: string
  ): Promise<boolean> {
    const participant = await this.sharing.liveParticipantById(
      participantId,
      generatedListId
    );
    return participant ? await this.sharing.seesZoneData(participant) : false;
  }

  /**
   * A zone line's product set, in attachment order, and which of it the line's
   * group is still responsible for (plan 0048, section 1.1; plan 0070, section 9).
   *
   * Both halves, because the announcement carries a whole `LineView` and a client
   * reconciles off it: one that reported only the products would take velista
   * `0065`'s marks off a subscribed line over somebody taking a purchase back.
   */
  private async zoneLineItemSet(
    manager: EntityManager,
    lineId: string
  ): Promise<LineItemSet> {
    const rows = await manager.getRepository(ListLineItem).find({
      where: { lineId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return toLineItemSet(rows);
  }
}

/**
 * How many units to take back, and what the caller believed before it asked
 * (plan 0104, section 3).
 */
export interface RevertUnitsRequest {
  /** The actor, who is recorded on every row this call marks. */
  participantId: string;
  /** How many units go back, newest purchase first. */
  units: number;
  /**
   * Take units back off one origin's purchases alone (section 4).
   *
   * Absent for a whole line walk, which reads every standing settlement of this
   * basket line whatever origin it sat on, waiting rows included.
   */
  originLineId?: string;
  /**
   * The outstanding amount the caller believed, re-checked under the write lock
   * and refused with `stale_quantity` on a mismatch.
   */
  expectOutstanding?: number;
  /**
   * The units this origin had bought, believed by the caller and re-checked the
   * same way. Meaningful only beside {@link originLineId}.
   */
  expectOriginSettled?: number;
}

/** An origin this revert could not put units back on. */
export interface RevertSkip {
  lineId: string;
  listId: string;
}

export interface RevertUnitsResult {
  /** How many origins this act could not put units back on. */
  skippedCount: number;
  /** Which, so a caller entitled to names can compose them. */
  skipped: RevertSkip[];
  /** How many units actually went back, which a close can push above what was asked. */
  taken: number;
}

/**
 * The standing settlements grouped into the acts a walk takes back, newest
 * first (plan 0104, section 3.3).
 *
 * A purchase is its own act and can be split. A `NOT_AVAILABLE` close is written
 * as one row per origin in a single settle, so its rows share a `settledAt` and
 * are folded into one entry: they were one gesture and they go back as one.
 *
 * A free function rather than a method because it is the rule itself, with no
 * database in it, which is what lets a test state the rule rather than mock its
 * way to it.
 */
export function revertEntries(
  standing: readonly LineSettlement[]
): RevertEntry[] {
  const entries: RevertEntry[] = [];
  const closes = new Map<number, RevertEntry>();
  for (const row of standing) {
    if (row.outcome !== SettlementOutcome.NOT_AVAILABLE) {
      entries.push({ close: false, rows: [row] });
      continue;
    }
    const at = row.settledAt.getTime();
    const held = closes.get(at);
    if (held) {
      held.rows.push(row);
      continue;
    }
    const entry: RevertEntry = { close: true, rows: [row] };
    closes.set(at, entry);
    entries.push(entry);
  }
  return entries;
}

/** One act a revert takes back whole, or takes part of. */
export interface RevertEntry {
  /** Whether it is a `NOT_AVAILABLE` close, which has no units to divide. */
  close: boolean;
  rows: LineSettlement[];
}

/** One origin's share of a revert, gathered while the walk runs. */
interface RevertedOrigin {
  /** The rows taken back, newest first, which is the walk's own order. */
  rows: LineSettlement[];
  /** How many units go back onto the zone line. A close puts back none. */
  restored: number;
}

/** One zone list's news, held until the transaction commits. */
interface ZoneAnnouncement {
  zoneId: string;
  listId: string;
  line: ListLine;
  settlement: LineSettlement;
  items: LineItemSet;
  settlementSummary: LineSettlementSummary;
  /**
   * The zone line's third indicator, filled in after the basket line is saved
   * and before the transaction closes (plan 0052, section 3.3).
   *
   * Written in a second pass for the reason the settle path writes it in one:
   * the loop runs before the basket line is taken back, and the derivation asks
   * exactly that question. Undefined until then, which no announcement is ever
   * emitted with.
   */
  claim?: LineClaim;
}
