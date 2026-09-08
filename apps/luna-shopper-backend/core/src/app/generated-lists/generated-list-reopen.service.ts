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
 * Taking a settled basket line back to outstanding (plan 0054, section 3).
 *
 * The reverse of {@link GeneratedListSettleService.settle}, and it is a service
 * of its own for the reason the settle is: it is the other operation on this
 * surface that reaches a zone list, and putting the two in one file would put
 * two transactions and two announcement paths behind one set of injected
 * repositories.
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

    // Whether the line was finished before this call, which is what decides
    // whether the claim it released comes back (plan 0052, section 3.3).
    const wasFinished = line.settledQuantity >= line.quantity;
    let skippedCount = 0;
    // Collected inside the transaction and published after it commits, which is
    // the convention everywhere in core: an event for a write that then rolled
    // back is a client showing something that never happened.
    const announcements: ZoneAnnouncement[] = [];

    await this.dataSource.transaction(async (manager) => {
      const zoneLines = manager.getRepository(ListLine);
      const settlements = manager.getRepository(LineSettlement);
      const basketLines = manager.getRepository(GeneratedListLine);
      const now = new Date();

      // Every settlement this basket line produced that still stands. Ordered so
      // the pass is deterministic, which matters only for the locks it takes,
      // and read inside the transaction because it is what the writes below are
      // computed from.
      const standing = await settlements.find({
        where: { generatedListLineId: line.id, revertedAt: IsNull() },
        order: { settledAt: 'ASC', id: 'ASC' },
      });

      // **Waiting rows are reverted and nothing else** (plan 0093, section 4).
      // A settle made before this line reached any list wrote a row attached to
      // the basket line alone, and taking that back is one column: there is no
      // zone line to restore units to, no list to name and no household to tell.
      // Marked here, ahead of the loop, so the loop below reasons about origins
      // only and never has to hold a `null` line id.
      const waiting: LineSettlement[] = [];
      const homed: LineSettlement[] = [];
      for (const settlement of standing) {
        (settlement.lineId === null ? waiting : homed).push(settlement);
      }
      for (const settlement of waiting) {
        settlement.revertedAt = now;
        settlement.revertedByParticipantId = req.participantId;
        await settlements.save(settlement);
      }

      // The room each touched list's news goes to, in one query rather than one
      // per settlement. The settle path takes this off the provenance row it is
      // already holding; this loop walks settlements, which record the list they
      // landed on and not the zone, so it is read here instead.
      const zones = await this.zonesOf(
        manager,
        homed.map((settlement) => settlement.listId as string)
      );

      // **Grouped by the origin they landed on, not walked one at a time.** One
      // basket line can settle the same origin twice, by being part settled and
      // then finished, so its standing settlements are not one per origin. The
      // household hears one event per line either way, carrying the line as this
      // whole call leaves it, and a skipped origin is counted once rather than
      // once per settle it swallowed.
      const byOrigin = new Map<string, LineSettlement[]>();
      for (const settlement of homed) {
        const rows = byOrigin.get(settlement.lineId as string);
        if (rows) {
          rows.push(settlement);
        } else {
          byOrigin.set(settlement.lineId as string, [settlement]);
        }
      }

      for (const [originLineId, rows] of byOrigin) {
        const zoneLine = await zoneLines.findOne({
          where: { id: originLineId },
          lock: { mode: 'pessimistic_write' },
        });

        let restored = 0;
        for (const settlement of rows) {
          settlement.revertedAt = now;
          settlement.revertedByParticipantId = req.participantId;
          await settlements.save(settlement);
          restored += settlement.quantity;
        }

        if (!zoneLine) {
          // The origin line was deleted, so there is nothing to put back. Its
          // settlements are still marked reverted, and the caller is told
          // something did not land, the way plan 0051 section 6.4 reports a skip
          // and for the same reason.
          skippedCount += 1;
          continue;
        }

        if (restored > 0) {
          // The units this basket took off are the units this basket puts back.
          // The line's current value is whatever else has happened to it since,
          // which is why this adds rather than restoring a remembered number: an
          // edit or another basket's settle in between is not this call's to
          // undo. A `NOT_AVAILABLE` settlement moved no units and puts none
          // back, and is marked all the same, because the indicator plan 0047
          // section 5 derives has to stop saying the shop had none.
          zoneLine.quantity += restored;
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
          // are older states of the same line's history.
          settlement: rows[rows.length - 1],
          items: await this.zoneLineItemSet(manager, zoneLine.id),
          // Counted after the reverts are saved, so the rows just marked are out
          // of it, and the most recent outcome is read rather than assumed: this
          // call removes settlements, so what is left is whatever stood before
          // the ones it undid, which may be nothing at all.
          settlementSummary: await this.summaryOf(settlements, zoneLine.id),
        });
      }

      line.settledQuantity = 0;
      line.lastEditedByParticipantId = req.participantId;
      line.lastEditedAt = now;
      await basketLines.save(line);

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

    // Section 5.2 governs the line's own projection here as everywhere else,
    // even though the act itself does not require it: `origins`, `targetListId`
    // and `origin` name zone data whichever call produced the line.
    const seesZoneData = await this.seesZoneData(req.participantId, list.id);
    const view = await this.generated.basketLineViewFor(line, seesZoneData);

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
    if (wasFinished) {
      this.claims.announce(
        true,
        list.ownerUserId,
        await this.claims.refsOfBasketLine(line.id)
      );
    }

    return { line: view, skippedCount };
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
   * The zone line's two indicators as this reopen leaves them (plan 0047,
   * section 5).
   *
   * Both are read, where the settle path could assume the outcome it had just
   * written. A reopen takes rows away instead, so what is left is whatever stood
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
