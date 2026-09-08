import { Injectable } from '@nestjs/common';
import {
  RealtimeEvent,
  SettlementOutcome,
  type LineClaim,
  type LineSettlementSummary,
} from '@portfolio/luna-shopper/contracts';
import { In, IsNull, type EntityManager, type Repository } from 'typeorm';
import {
  GeneratedListLineOrigin,
  LineSettlement,
  ListLine,
  ListLineItem,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toLineItemSet, type LineItemSet } from '../lists/line-item-set';
import { toLineSettlementView, toLineView } from '../lists/list.mappers';
import { LineClaimService } from './line-claim.service';

/**
 * The purchases that were made before a basket line reached any list, and how
 * they come home (plan 0092 section 4.3, filled by plan 0093).
 *
 * ## Why the seam exists before the thing it holds
 *
 * Plan 0092 made "send this line to that list" an ordinary write: raising a
 * list's row from zero creates or adopts a line and inserts a provenance row.
 * The moment that row exists, the units this basket already bought on the line
 * have somewhere to belong, and this service re-homes them. Both places that
 * insert such a row call {@link rehome}, so plan 0093 filled one method rather
 * than finding every insert again and adding the call to each.
 *
 * ## What a waiting settlement is
 *
 * A row of `line_settlements` with `lineId` and `listId` null (plan 0093,
 * section 2). It belongs to a basket line, through `generatedListLineId`, and to
 * no zone line yet. Somebody adds "batteries" in the shop, buys four, and sends
 * the line to the flat's list at home: the four are written when they are
 * bought, dated and attributed, and they land on the flat's line when it
 * receives them. Before this plan they were written nowhere at all, so the flat
 * got a line asking for nothing and a history saying batteries were never
 * bought.
 *
 * Nothing that reads by list can see one, which section 2.2 makes structural
 * rather than careful: every such read selects by `lineId` and joins the list for
 * access, so a null `lineId` row is invisible to it by construction.
 *
 * ## Two phases, because an event must not outrun its commit
 *
 * {@link rehome} writes and returns what happened; {@link announce} says it out
 * loud. They are separate for the convention every write path in core follows: an
 * event for a write that then rolled back is a client showing something that
 * never happened. So a caller inside a transaction collects the answer and
 * announces after the commit, and a caller writing through a plain manager
 * announces straight away.
 *
 * **{@link rehome} is called inside the caller's transaction**, which is why the
 * manager is a required argument rather than a convenience. Re-homing lowers zone
 * lines and moves settlement rows, so it commits with the origin row that made it
 * possible or not at all.
 *
 * ## It takes no pessimistic lock, and lowers the zone line in one statement
 *
 * A settle locks each origin's zone line before moving it. This cannot: one of
 * its two callers writes through a plain entity manager rather than a
 * transaction, and a pessimistic lock outside a transaction is an error rather
 * than a weaker lock. So the decrement is a single `UPDATE ... GREATEST(0, ...)`,
 * which is atomic wherever it runs and floors at zero exactly as a settle does
 * (plan 0047, section 4.2), and the row is read back afterwards for the event.
 */
@Injectable()
export class WaitingSettlementService {
  constructor(
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Give this line's waiting purchases to the origins it now has (plan 0093,
   * section 3).
   *
   * The allocation rule applied to the past. Waiting `BOUGHT` rows go oldest
   * first, over origins oldest first, and each origin takes units up to its own
   * room: what it contributed, less what this basket has already bought against
   * it. A row that fits whole is re-homed; a row that fits partly is **split**,
   * the fitting units re-homed as a new row and the rest left waiting, dated and
   * attributed exactly as it was. Units that fit nowhere stay waiting for the
   * next list the line reaches.
   *
   * ## Access is not re-asked here
   *
   * A settle checks the basket owner's standing on each origin's list before
   * writing to it (plan 0051, section 6.4), and this does not repeat the check.
   * Every caller has just written a provenance row for a list it verified the
   * owner may write, and that row is the standing evidence that this basket draws
   * from that list. Asking again would also mean a second connection while the
   * caller's transaction holds one, which is the pool deadlock the settle path
   * takes care to avoid.
   *
   * @param generatedListLineId the basket line whose origins just grew.
   * @param manager the caller's transaction, which this must write through.
   * @returns one entry per re-homed row, for {@link announce} after the commit.
   */
  async rehome(
    generatedListLineId: string,
    manager: EntityManager
  ): Promise<RehomedSettlement[]> {
    const settlements = manager.getRepository(LineSettlement);

    // Every standing row this basket line has produced, in one read: the waiting
    // ones are what this call places, and the ones already home are what decides
    // how much room each origin has left. Reverted rows are excluded by the same
    // clause, which is section 3.2: a purchase somebody took back is history and
    // not a fact about any list, so it never comes home.
    const standing = await settlements.find({
      where: { generatedListLineId, revertedAt: IsNull() },
      order: { settledAt: 'ASC', id: 'ASC' },
    });
    const waiting = standing.filter((row) => row.lineId === null);
    if (waiting.length === 0) {
      return [];
    }

    const origins = await manager.getRepository(GeneratedListLineOrigin).find({
      where: { generatedListLineId },
      // Oldest provenance first, the order `allocateOldestFirst` uses.
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    // An origin whose zone line has been deleted underneath the basket is not
    // somewhere a purchase can land, and it is an ordinary thing to have in a
    // history rather than an error (plan 0050, section 1). Read in one query
    // rather than one per origin.
    const zoneLines = await this.zoneLinesById(
      manager,
      origins.map((origin) => origin.lineId)
    );
    const reachable = origins.filter((origin) => zoneLines.has(origin.lineId));
    if (reachable.length === 0) {
      return [];
    }

    // What each origin has room for: what this list contributed, less what this
    // basket has already bought against it. `BOUGHT` only, because
    // `NOT_AVAILABLE` closes an outstanding amount without buying anything.
    const room = new Map<string, number>();
    for (const origin of reachable) {
      room.set(origin.lineId, origin.quantity);
    }
    for (const row of standing) {
      if (row.lineId === null || row.outcome !== SettlementOutcome.BOUGHT) {
        continue;
      }
      const left = room.get(row.lineId);
      if (left !== undefined) {
        room.set(row.lineId, Math.max(0, left - row.quantity));
      }
    }

    const rehomed: RehomedSettlement[] = [];
    // Walked across waiting rows rather than restarted for each: an origin
    // filled by the first row has no room for the second, and rewinding would
    // ask it again for every row.
    let next = 0;
    for (const row of waiting) {
      if (row.outcome !== SettlementOutcome.BOUGHT || row.quantity <= 0) {
        continue;
      }
      while (next < reachable.length) {
        const origin = reachable[next];
        const available = room.get(origin.lineId) ?? 0;
        if (available === 0) {
          next += 1;
          continue;
        }
        const take = Math.min(available, row.quantity);
        room.set(origin.lineId, available - take);
        const whole = take === row.quantity;
        const homed = whole
          ? await this.comeHome(settlements, row, origin)
          : await this.split(settlements, row, origin, take);
        rehomed.push(await this.announcementFor(manager, origin, homed, take));
        if (whole) {
          break;
        }
        // The rest of the row keeps waiting, still dated and attributed as it
        // was. The next list this line reaches gets it.
        row.quantity -= take;
        await settlements.save(row);
      }
    }

    // **The outcome goes to the first origin, whole, and once** (section 3.1). A
    // waiting `NOT_AVAILABLE` row says the shop had none, about the product and
    // not about units, so it is never split and never copied to a later list:
    // the household's line then reads "not available last trip" if that row is
    // its most recent, which is true. It cannot reach a second list, because
    // after this call the basket line has no waiting rows of that outcome left.
    const first = reachable[0];
    for (const row of waiting) {
      if (row.outcome !== SettlementOutcome.NOT_AVAILABLE) {
        continue;
      }
      const homed = await this.comeHome(settlements, row, first);
      // Zero units, so the zone line does not move: an outcome is not a
      // quantity. The household hears it all the same, because the indicator
      // plan 0047 section 5 derives is what the row is for.
      rehomed.push(await this.announcementFor(manager, first, homed, 0));
    }

    return rehomed;
  }

  /**
   * Tell each household what landed on its line (plan 0093, section 3).
   *
   * `line.settled` per re-homed row, unchanged in shape, on the zone room the
   * origin names. A list that asked for three and receives three lands at zero
   * with a `BOUGHT` row, which is plan 0047 section 5's bought indicator, and
   * that is the sentence this plan exists for.
   *
   * Called **after** the caller's transaction commits, never inside it.
   */
  announce(rehomed: readonly RehomedSettlement[]): void {
    for (const entry of rehomed) {
      this.events.emit(
        RealtimeEvent.LineSettled,
        entry.zoneId,
        {
          line: toLineView(
            entry.line,
            entry.items,
            entry.settlementSummary,
            entry.claim
          ),
          settlement: toLineSettlementView(entry.settlement),
        },
        entry.listId
      );
    }
  }

  /**
   * The whole row comes home: `lineId` and `listId` set, everything else kept
   * (section 3, rule 4).
   *
   * The time, the person, the product and the units are the row's own and are
   * not rewritten. A purchase re-homed a week later is still a purchase made a
   * week ago, which is the entire point of having written it when it happened.
   */
  private async comeHome(
    settlements: Repository<LineSettlement>,
    row: LineSettlement,
    origin: GeneratedListLineOrigin
  ): Promise<LineSettlement> {
    row.lineId = origin.lineId;
    row.listId = origin.listId;
    return settlements.save(row);
  }

  /**
   * The row fits partly, so it becomes two (section 3, rule 5).
   *
   * A new row carries the units that fit and is home; the original keeps the
   * rest and is still waiting. Both keep the original's time, participant and
   * product, because they are two parts of one purchase rather than two
   * purchases.
   */
  private async split(
    settlements: Repository<LineSettlement>,
    row: LineSettlement,
    origin: GeneratedListLineOrigin,
    units: number
  ): Promise<LineSettlement> {
    return settlements.save(
      settlements.create({
        lineId: origin.lineId,
        listId: origin.listId,
        itemId: row.itemId,
        outcome: row.outcome,
        quantity: units,
        settledByUserId: row.settledByUserId,
        settledByParticipantId: row.settledByParticipantId,
        settledAt: row.settledAt,
        // Standing, always: a reverted row is never re-homed at all, so a part
        // of one cannot be either (section 3.2).
        revertedAt: null,
        revertedByParticipantId: null,
        generatedListLineId: row.generatedListLineId,
        pricePaidCents: row.pricePaidCents,
        supermarketLocationId: row.supermarketLocationId,
      })
    );
  }

  /**
   * Lower the zone line by what landed on it and read back what to say about it.
   *
   * The decrement is one statement rather than a read, a subtraction and a save,
   * because this runs outside a transaction on one of its two paths and a lost
   * update there would take units off a household's line and leave them on it.
   * `GREATEST` is the floor a settle applies for the same reason (plan 0047,
   * section 4.2): the list may already be below what this basket bought, because
   * somebody settled it from the list page, and it lands at zero rather than
   * below it.
   */
  private async announcementFor(
    manager: EntityManager,
    origin: GeneratedListLineOrigin,
    settlement: LineSettlement,
    units: number
  ): Promise<RehomedSettlement> {
    const zoneLines = manager.getRepository(ListLine);
    if (units > 0) {
      await manager.query(
        `UPDATE "list_lines"
            SET "quantity" = GREATEST(0, "quantity" - $2),
                "version" = "version" + 1
          WHERE "id" = $1`,
        [origin.lineId, units]
      );
    }
    // Read back rather than adjusted in memory, so the event carries the line as
    // it now stands rather than as this call believes it left it.
    const line = await zoneLines.findOne({ where: { id: origin.lineId } });
    if (!line) {
      // Read once at the top of `rehome` and gone by now, which needs a
      // concurrent delete between the two. The units are written and the row is
      // home; only the household cannot be told, because the line they would be
      // told about is not there.
      throw new Error('The origin line vanished while its purchase came home');
    }
    return {
      // The provenance row carries the zone, which is why it records one:
      // reaching for it through the list would be a join to learn something
      // written down at generation time.
      zoneId: origin.zoneId,
      listId: line.listId,
      line,
      settlement,
      items: await this.zoneLineItemSet(manager, line.id),
      settlementSummary: await this.summaryOf(manager, line.id),
      // Asked rather than assumed: this call does not change what the basket
      // still has outstanding, so the claim is whatever it already was, and
      // leaving it out would take the third indicator off a claimed line.
      claim: await this.claims.claimOf(line.id, manager),
    };
  }

  /** The zone lines a set of provenance rows points at, in one read. */
  private async zoneLinesById(
    manager: EntityManager,
    lineIds: readonly string[]
  ): Promise<Map<string, ListLine>> {
    const unique = [...new Set(lineIds)];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await manager
      .getRepository(ListLine)
      .find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * A zone line's product set, in attachment order, and which of it the line's
   * group is still responsible for (plan 0048, section 1.1; plan 0070, section 9).
   *
   * Both halves, because the announcement carries a whole `LineView` and a client
   * reconciles off it: one that reported only the products would take velista
   * `0065`'s marks off every subscribed line the moment a purchase came home.
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

  /**
   * The zone line's two settlement indicators as this row leaves them (plan
   * 0047, section 5).
   *
   * Counted after the row is home, so it is in the count, and the most recent
   * outcome is read rather than assumed to be this row's: a purchase re-homed
   * today may have been made before one the list already had.
   */
  private async summaryOf(
    manager: EntityManager,
    lineId: string
  ): Promise<LineSettlementSummary> {
    const settlements = manager.getRepository(LineSettlement);
    // Sequential rather than `Promise.all`: one manager is one connection, so
    // two queries issued at once on it are serialised by the driver anyway.
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
}

/**
 * One purchase that has just come home, held until the caller's transaction
 * commits (plan 0093, section 3).
 *
 * Everything the household's `line.settled` needs, gathered while the manager
 * that wrote it is still open, for the reason the settle path gathers its own:
 * the announcement carries a whole `LineView` and a client reconciles off it, so
 * reading it afterwards would be a second query answering a question this call
 * already knew.
 */
export interface RehomedSettlement {
  zoneId: string;
  listId: string;
  line: ListLine;
  settlement: LineSettlement;
  items: LineItemSet;
  settlementSummary: LineSettlementSummary;
  claim: LineClaim;
}
