import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  NO_LINE_CLAIM,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListAllocationEntry,
  type GeneratedListLineMovedEvent,
  type GeneratedListSettleResult,
  type GeneratedListSettleSkip,
  type GeneratedListSettlementRef,
  type LineClaim,
  type LineSettlementSummary,
  type SettleGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { toLineSettlementView, toLineView } from '../lists/list.mappers';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { LineClaimService } from './line-claim.service';
import { namesOfLists } from './list-names';

/**
 * Settling a basket back to the lines it came from (plan 0051, section 6).
 *
 * The half of the plan that does real work, and the half plan 0047 was shaped to
 * receive: settling is an **append** rather than a contested update, so plan 0050
 * section 6's `applyStatuses`, its `lineVersion` conflicts and its partial apply
 * machinery are gone, and what is left is an allocation and a write.
 *
 * ## The security property, stated where it is implemented
 *
 * **A settle is authorized by the owner's access, never the actor's**
 * (section 6.4). Before a settlement is written to an origin, the check is
 * whether the basket's owner still holds `WRITE` on that origin's list. Not the
 * guest's access, because a guest has none, and not a stored grant from
 * generation time, because access moves.
 *
 * So a guest can never cause a write anywhere the owner could not have written
 * themselves. The owner delegated shopping, not permission.
 *
 * ## Why the whole thing is not one transaction with the access check inside it
 *
 * The access read runs before the transaction opens, exactly as
 * {@link SettlementService.settle} does it and for the same reason: every
 * repository the access service holds draws its own connection from the pool, so
 * asking it a question from inside a transaction means one request holding two,
 * which deadlocks a pool under load rather than failing honestly.
 */
@Injectable()
export class GeneratedListSettleService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOrigin)
    private readonly origins: Repository<GeneratedListLineOrigin>,
    @InjectRepository(GeneratedListLineOption)
    private readonly options: Repository<GeneratedListLineOption>,
    // Read only, and only to name an origin this settle could not reach, for a
    // reader who passes section 5.2 (plan 0053, section 4).
    @InjectRepository(ShoppingList)
    private readonly shoppingLists: Repository<ShoppingList>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  async settle(
    req: SettleGeneratedListLineRequest
  ): Promise<GeneratedListSettleResult> {
    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
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

    const outstanding = Math.max(0, line.quantity - line.settledQuantity);
    if (outstanding === 0) {
      throw new ValidationException('This line is already finished', {
        messageArgs: { field: 'lineId' },
      });
    }

    const itemId = await this.resolvePick(line, req.itemId);
    const origins = await this.origins.find({
      where: { generatedListLineId: line.id },
      // Oldest provenance first (section 6.2), which is the default allocation.
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    // Section 6.4: the owner's standing, now, on each origin's list.
    const writable = await this.sharing.writableAmong(list.ownerUserId, [
      ...new Set(origins.map((origin) => origin.listId)),
    ]);

    const skipped: GeneratedListSettleSkip[] = [];
    const eligible: GeneratedListLineOrigin[] = [];
    for (const origin of origins) {
      if (!writable.has(origin.listId)) {
        skipped.push({
          lineId: origin.lineId,
          listId: origin.listId,
          reason: 'ACCESS_GONE',
          // Filled in on the way out, for a reader entitled to them (plan 0053,
          // section 4). Null here rather than absent so the shape is complete
          // whichever branch of the redaction the answer takes.
          listName: null,
          zoneName: null,
        });
        continue;
      }
      eligible.push(origin);
    }

    const units = this.resolveUnits(req, outstanding);
    const plan =
      req.allocations && req.allocations.length > 0
        ? this.allocateByHand(req.allocations, eligible, units)
        : allocateOldestFirst(eligible, units);

    const written: GeneratedListSettlementRef[] = [];
    // Whether this settle finished the basket line, which is what decides
    // between a claim that moved and one that ended (plan 0052, section 3.3).
    let finished = false;
    // Collected inside the transaction and published after it commits, which is
    // the convention everywhere in core: an event for a write that then rolled
    // back is a client showing something that never happened.
    const announcements: ZoneAnnouncement[] = [];

    await this.dataSource.transaction(async (manager) => {
      const zoneLines = manager.getRepository(ListLine);
      const settlements = manager.getRepository(LineSettlement);
      const basketLines = manager.getRepository(GeneratedListLine);
      const now = new Date();
      let applied = 0;

      for (const [origin, allocated] of plan) {
        // NOT_AVAILABLE writes a row per origin with no units, which is what
        // makes the indicator in plan 0047 section 5 derivable. BOUGHT with a
        // zero allocation writes nothing, because nothing happened to that
        // origin.
        if (allocated === 0 && req.outcome === SettlementOutcome.BOUGHT) {
          continue;
        }

        const zoneLine = await zoneLines.findOne({
          where: { id: origin.lineId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!zoneLine) {
          // The basket outlived its origin, which is an ordinary thing to have in
          // a history rather than an error (plan 0050, section 1).
          skipped.push({
            lineId: origin.lineId,
            listId: origin.listId,
            reason: 'ORIGIN_DELETED',
            listName: null,
            zoneName: null,
          });
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
            lineId: zoneLine.id,
            listId: zoneLine.listId,
            itemId,
            outcome: req.outcome,
            quantity: req.outcome === SettlementOutcome.BOUGHT ? allocated : 0,
            // The participant, always, including for the owner (section 6 and
            // the check constraint the migration adds).
            settledByUserId: null,
            settledByParticipantId: req.participantId,
            settledAt: now,
            generatedListLineId: line.id,
            pricePaidCents: null,
            supermarketLocationId: null,
          })
        );

        written.push({
          settlementId: settlement.id,
          lineId: zoneLine.id,
          listId: zoneLine.listId,
          quantity: settlement.quantity,
        });
        applied += allocated;

        announcements.push({
          // The provenance row carries the zone, which is why it records one:
          // reaching for it through the list would be a join to learn something
          // already written down at generation time.
          zoneId: origin.zoneId,
          listId: zoneLine.listId,
          line: zoneLine,
          settlement,
          // The set is read rather than assumed empty: `toLineView` takes it as
          // an argument precisely so a line with two products is never reported
          // as a free text line.
          itemIds: await this.zoneLineItemIds(manager, zoneLine.id),
          // And the two indicators, for the same reason and with more force
          // (plan 0047, section 5). This is the path a purchase normally takes,
          // so announcing the zero summary here would take the bought indicator
          // off the household's line at the exact moment somebody bought it.
          //
          // Counted inside the transaction, after the insert, so it includes the
          // row just written; the most recent outcome needs no query, being that
          // row by construction. One settlement per zone line per call, because
          // each origin is settled once.
          settlementSummary: {
            boughtCount: await settlements.count({
              where: { lineId: zoneLine.id, outcome: SettlementOutcome.BOUGHT },
            }),
            lastOutcome: req.outcome,
          },
        });
      }

      // NOT_AVAILABLE closes the outstanding amount rather than settling units
      // (section 6.1): it is an outcome, not a quantity.
      const advance =
        req.outcome === SettlementOutcome.NOT_AVAILABLE ? outstanding : applied;

      line.settledQuantity = Math.min(
        line.quantity,
        line.settledQuantity + advance
      );
      if (itemId !== line.itemId) {
        line.itemId = itemId;
      }
      line.lastEditedByParticipantId = req.participantId;
      line.lastEditedAt = now;
      await basketLines.save(line);

      // After the basket line is saved and still inside the transaction, so the
      // derivation sees the settle that has just happened (plan 0052, section
      // 3.3). A line settled all the way through releases its origins, and this
      // is the read that says so on the very event announcing the purchase.
      const claims = await this.claims.claimsOf(
        announcements.map((entry) => entry.line.id),
        manager
      );
      for (const entry of announcements) {
        entry.claim = claims.get(entry.line.id) ?? NO_LINE_CLAIM;
      }
      finished = line.settledQuantity >= line.quantity;
    });

    for (const announcement of announcements) {
      // Each zone list hears the ordinary plan 0047 event, so the household sees
      // the bread was got without learning which basket got it: the payload
      // carries no participant and no basket, and `settledByUserId` is null,
      // which is all a zone reader learns about where it came from.
      this.events.emit(
        RealtimeEvent.LineSettled,
        announcement.zoneId,
        {
          line: toLineView(
            announcement.line,
            announcement.itemIds,
            announcement.settlementSummary,
            announcement.claim ?? NO_LINE_CLAIM
          ),
          settlement: toLineSettlementView(announcement.settlement),
        },
        announcement.listId
      );
    }

    // Section 5.2, on the way out as well as on the way in. This route is on the
    // participant surface, so a guest reaches it, and every field of a
    // settlement ref, of a skip and of a line's origins names a zone or a list.
    const seesZoneData = await this.seesZoneData(req.participantId, list.id);

    // The basket's own room, so four people working through one list in a shop
    // agree without a refetch (section 10). Redacted to the least privileged
    // reader in the room, because a broadcast cannot be projected per socket,
    // and carrying no settlements at all: those are the acting participant's own
    // feedback and belong in their response, not in a broadcast to the shop.
    const announcement: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      line: await this.generated.basketLineViewFor(line, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineSettled,
      list.id,
      announcement
    );
    // And the owner's own sessions, which is a different audience and not a
    // duplicate of the room: the owner is usually **not** in the basket's room.
    // They are at home looking at the dashboard while somebody else shops, and
    // velista 0045's card counts settled lines, so without this it is stale until
    // they open the basket. An owner who happens to be in both hears it twice,
    // which costs nothing: the client merges one line by id, idempotently.
    this.events.emitToUsers(
      RealtimeEvent.GeneratedListLineSettled,
      [list.ownerUserId],
      announcement
    );

    // A basket line settled all the way through has left the basket in every
    // sense that matters to a zone (plan 0052, section 3.3), so the lines it
    // came from stop being claimed. Every origin and not only the ones this call
    // allocated to: a line that is finished is finished for the skipped ones too.
    if (finished) {
      await this.claims.announceReleased(
        await this.claims.refsOfBasketLine(line.id)
      );
    }

    const view = await this.generated.basketLineViewFor(line, seesZoneData);
    // The count survives the redaction and the names do not (section 6.4): a
    // shopper who reached two households out of three has to be told, and only
    // whose the third was is gated.
    if (!seesZoneData) {
      return { line: view, skippedCount: skipped.length };
    }

    // Named only now, and only on this branch (plan 0053, section 4). The basket
    // screen reaches no zone list store and deliberately never will
    // (velista `settle-sheet.ts:333`), so an unreachable origin was a count and
    // never a name; the composition belongs on this side, where the access
    // question has already been answered.
    //
    // One query for every skipped origin rather than one each, and none at all
    // in the ordinary case, which is the one where nothing was skipped.
    const names = await namesOfLists(
      this.shoppingLists,
      skipped.map((entry) => entry.listId)
    );
    return {
      line: view,
      skippedCount: skipped.length,
      settlements: written,
      skipped: skipped.map((entry) => {
        const named = names.get(entry.listId);
        return {
          ...entry,
          listName: named?.name ?? null,
          zoneName: named?.zoneName ?? null,
        };
      }),
    };
  }

  /**
   * Whether this actor may be told which lists their settle touched.
   *
   * Asked of core's own access tables at request time (section 5.2), never taken
   * from the request: the gateway computes the same value for its own guard, but
   * a value that travelled through a message is a value a future caller could
   * send.
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

  /** A zone line's product set, in attachment order (plan 0048, section 1.1). */
  private async zoneLineItemIds(
    manager: EntityManager,
    lineId: string
  ): Promise<string[]> {
    const rows = await manager.getRepository(ListLineItem).find({
      where: { lineId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => row.itemId);
  }

  /**
   * How many units this act settles.
   *
   * `NOT_AVAILABLE` ignores any number it was given, because it is an outcome
   * rather than a quantity, and a caller who sends both has said two things and
   * meant the first.
   */
  private resolveUnits(
    req: SettleGeneratedListLineRequest,
    outstanding: number
  ): number {
    if (req.outcome === SettlementOutcome.NOT_AVAILABLE) {
      return 0;
    }
    if (req.quantity === undefined) {
      return outstanding;
    }
    if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
      throw new ValidationException(
        'quantity must be a positive whole number',
        {
          messageArgs: { field: 'quantity' },
        }
      );
    }
    // Capped at the outstanding amount rather than refused: a shopper who taps
    // settle twice on a line of three has bought three, not six, and the second
    // tap should finish the line rather than fail.
    return Math.min(req.quantity, outstanding);
  }

  /**
   * The allocation sheet (section 6.3): the same operation with the allocation
   * supplied instead of derived, so it writes the same settlements.
   */
  private allocateByHand(
    allocations: GeneratedListAllocationEntry[],
    eligible: GeneratedListLineOrigin[],
    units: number
  ): Map<GeneratedListLineOrigin, number> {
    const asked = new Map<string, number>();
    for (const entry of allocations) {
      if (!Number.isInteger(entry.quantity) || entry.quantity < 0) {
        throw new ValidationException(
          'each allocation must be a whole number of units',
          { messageArgs: { field: 'allocations' } }
        );
      }
      asked.set(entry.listId, (asked.get(entry.listId) ?? 0) + entry.quantity);
    }

    const total = [...asked.values()].reduce((sum, n) => sum + n, 0);
    if (total > units) {
      throw new ValidationException(
        'the allocation adds up to more than was settled',
        { messageArgs: { field: 'allocations' } }
      );
    }

    const plan = new Map<GeneratedListLineOrigin, number>();
    // Within one list the oldest origin still goes first, so the sheet decides
    // between lists and the default rule decides inside one, which is the only
    // question the sheet does not ask about.
    for (const origin of eligible) {
      const left = asked.get(origin.listId) ?? 0;
      const take = Math.min(left, origin.quantity);
      plan.set(origin, take);
      asked.set(origin.listId, left - take);
    }
    const unplaced = [...asked.values()].reduce((sum, n) => sum + n, 0);
    if (unplaced > 0) {
      throw new ValidationException(
        'the allocation names a list this line does not come from',
        { messageArgs: { field: 'allocations' } }
      );
    }
    return plan;
  }

  /**
   * The product this settle records (section 6.1, and plan 0047 section 3.2).
   *
   * A swap is only allowed to one of the line's own options, which is what keeps
   * it a gesture at the shelf rather than a way to write an arbitrary catalog id
   * into a household's purchase history.
   */
  private async resolvePick(
    line: GeneratedListLine,
    itemId: string | undefined
  ): Promise<string | null> {
    if (itemId === undefined) {
      return line.itemId;
    }
    const option = await this.options.findOne({
      where: { generatedListLineId: line.id, itemId },
    });
    if (!option) {
      throw new ValidationException(
        'That product is not one of this line’s options',
        {
          messageArgs: { field: 'itemId' },
        }
      );
    }
    return itemId;
  }
}

/** One zone list's news, held until the transaction commits. */
interface ZoneAnnouncement {
  zoneId: string;
  listId: string;
  line: ListLine;
  settlement: LineSettlement;
  itemIds: string[];
  /**
   * The zone line's two indicators as this settle leaves them (plan 0047,
   * section 5).
   *
   * Captured inside the transaction rather than recomputed out here, for the
   * same reason `itemIds` is: the announcement carries a whole `LineView` and a
   * client reconciles off it, so a summary read after the commit would be a
   * second query answering a question this loop already knew.
   */
  settlementSummary: LineSettlementSummary;
  /**
   * The zone line's third indicator, filled in after the basket line is saved
   * and before the transaction closes (plan 0052, section 3.3).
   *
   * Written in a second pass rather than inside the loop, because the loop runs
   * before the settle is applied to the basket line and the derivation asks
   * exactly that question: whether the basket still has anything outstanding on
   * this line. Undefined until then, which no announcement is ever emitted with.
   */
  claim?: LineClaim;
}

/**
 * Oldest provenance row first, until the settled quantity is exhausted (plan
 * 0051, section 6.2).
 *
 * A basket line can sum several zone lines: milk from the flat list (2) and from
 * the parents' list (1) is one line of 3, and buying 2 has to land somewhere.
 *
 * Deterministic, explicable in one sentence, and **identical to the obvious
 * answer in the overwhelmingly common case where a line has exactly one origin**.
 * Proportional splitting was rejected for producing fractional units of things
 * that come in units.
 *
 * A free function rather than a method because it is the rule itself, with no
 * database in it, which is what lets a test state the rule rather than mock its
 * way to it.
 */
export function allocateOldestFirst(
  origins: readonly GeneratedListLineOrigin[],
  units: number
): Map<GeneratedListLineOrigin, number> {
  const plan = new Map<GeneratedListLineOrigin, number>();
  let left = units;
  for (const origin of origins) {
    const take = Math.min(left, origin.quantity);
    plan.set(origin, take);
    left -= take;
  }
  // More bought than the origins asked for is not an error (plan 0047,
  // section 4.2): the excess is real and the last origin carries it, so the
  // consumption history is not quietly clamped to the demand.
  if (left > 0 && origins.length > 0) {
    const last = origins[origins.length - 1];
    plan.set(last, (plan.get(last) ?? 0) + left);
  }
  return plan;
}
