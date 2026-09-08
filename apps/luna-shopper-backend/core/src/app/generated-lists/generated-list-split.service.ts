import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_LIMITS,
  isLiveGeneratedList,
  RealtimeEvent,
  SettlementOutcome,
  type GeneratedListBasketLineView,
  type GeneratedListLineAddedEvent,
  type GeneratedListLineMovedEvent,
  type GeneratedListLineShare,
  type SplitGeneratedListLineRequest,
  type SplitGeneratedListLineResult,
} from '@portfolio/luna-shopper/contracts';
import {
  GeneratedListFinishedException,
  NotFoundException,
  StaleQuantityException,
  UnauthorizedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  LineSettlement,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { findMergeTarget } from './basket-merge';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';

/**
 * A line split by the product that was got (plan 0094).
 *
 * A line says "Milk", five, and names one pick out of eleven milks. At the shelf
 * the shopper takes three skimmed and two whole, and until this plan the line
 * could record one of those and the other three units were settled as the wrong
 * milk or as no milk at all.
 *
 * ## The rule, and why it is a split rather than a list of products on one line
 *
 * > **A basket line holds one product. Assigning units to other products
 * > creates one sibling per product under the line, moves the units and their
 * > origins to it, and the original keeps what is left.**
 *
 * The first draft of the feature put several products with quantities on one
 * line and was rejected on one fact: **a settlement names one product, and
 * everything downstream of a settlement assumes a line does too.** Splitting
 * leaves the settle, the reopen, the claim and the send to a list exactly as
 * they are; a line holding several products would have changed all five.
 *
 * ## This is not a purchase
 *
 * Nothing here writes a settlement, moves `settledQuantity` or touches a zone
 * line. It redistributes what this basket will buy across rows that each name
 * one product. The lists asked for what they asked for, and the split changed
 * only which basket row will buy it, so **no zone event is emitted, ever**, and
 * claims do not move: a zone line is claimed while any carrier has outstanding
 * units, and the claim query is already per zone line.
 *
 * ## It replaces the pick
 *
 * `generatedList.setPick` is gone. Moving every outstanding unit to another
 * product is this write with one share, and two ways of choosing a product would
 * be two rules about which product a settlement records.
 */
@Injectable()
export class GeneratedListSplitService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOption)
    private readonly options: Repository<GeneratedListLineOption>,
    @InjectRepository(LineSettlement)
    private readonly settlements: Repository<LineSettlement>,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Give units of a line to other products (section 2).
   *
   * **Anybody holding the basket may do this, guests included.** The products
   * are the line's own options, which are catalog data, and the origins that
   * move with them are never shown to anybody who could not see them already.
   * So there is no `seesZoneData` check on the write, only on what is handed
   * back.
   */
  async split(
    req: SplitGeneratedListLineRequest
  ): Promise<SplitGeneratedListLineResult> {
    const { list, seesZoneData } = await this.resolve(req);

    if (!isLiveGeneratedList(list.status)) {
      // Plan 0055 section 3.3's code rather than a validation failure: a client
      // that cannot tell a state it can explain from a bug it cannot will show
      // the wrong sentence for both.
      throw new GeneratedListFinishedException(
        'This basket is finished, so its lines cannot be split'
      );
    }

    const line = await this.lines.findOne({
      where: { id: req.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    const outstanding = Math.max(0, line.quantity - line.settledQuantity);
    if (req.from !== outstanding) {
      // Plan 0056 section 3.2. Two phones splitting one line must not double it,
      // and what a gesture meant depends on where it started, so the client
      // refetches and shows the number as it now stands.
      throw new StaleQuantityException(
        'This line has changed since it was read',
        { messageArgs: { current: outstanding } }
      );
    }

    const shares = this.checkShares(req.shares, line);
    if (shares.length === 0) {
      // Every share was zero, which is what a client sending a stepper per
      // option sends when nothing was touched. Nothing is written and nothing is
      // announced, rather than an error for a gesture that said nothing.
      return {
        line: await this.generated.basketLineViewFor(line, seesZoneData),
        created: [],
        merged: [],
        removed: [],
      };
    }
    await this.checkOptions(line, shares);

    const asked = shares.reduce((sum, share) => sum + share.quantity, 0);
    if (asked > outstanding) {
      // There is nothing to give. Shares sum to **at most** the outstanding
      // amount, and the balance goes to the original's product without ever
      // being typed.
      throw new ValidationException(
        'That is more than this line still has to get',
        { messageArgs: { field: 'shares' } }
      );
    }

    const applied = await this.apply(line, shares, asked, req.participantId);
    return this.answer(list, applied, seesZoneData);
  }

  // --- The write -------------------------------------------------------------

  /**
   * One transaction: the original, its siblings, their origins and the rows a
   * merge folded away move together or not at all.
   *
   * The whole basket is read inside it, because the merge rule of section 5 is a
   * question about rows other than this one and a share that finds a sibling
   * must find the same sibling the concurrent read did.
   */
  private async apply(
    line: GeneratedListLine,
    shares: readonly GeneratedListLineShare[],
    asked: number,
    participantId: string
  ): Promise<AppliedSplit> {
    const balance = Math.max(0, line.quantity - line.settledQuantity) - asked;
    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      const lines = manager.getRepository(GeneratedListLine);
      const options = manager.getRepository(GeneratedListLineOption);

      const basket = await lines.find({
        where: { generatedListId: line.generatedListId },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
      const others = basket.filter((row) => row.id !== line.id);

      const allocator = await this.allocatorFor(manager, line);
      const positions = this.positionsAfter(basket, line);
      const copied = await options.find({
        where: { generatedListLineId: line.id },
        order: { position: 'ASC', createdAt: 'ASC' },
      });

      // Section 2.2: with nothing settled and nothing left over, the original is
      // **reassigned** rather than deleted, so its id, its position, its "who put
      // this here" and any waiting rows survive. Taken by the first share that
      // does not already have a row of its own, because a share that does has
      // somewhere better to go and reassigning as well would put one product on
      // two rows, which is the state this whole plan exists to prevent.
      const emptied = balance === 0 && line.settledQuantity === 0;
      let reassigned = false;

      const created: GeneratedListLine[] = [];
      const merged: GeneratedListLine[] = [];
      // Every row a later share may land on. The original is **not** in it until
      // it has been reassigned: before that it is the row being split, and a
      // product free one would otherwise match the merge rule and take a share
      // straight back. After it, it is an ordinary row naming a product, so a
      // second share for that product raises it rather than making a twin.
      const candidates: GeneratedListLine[] = [...others];

      for (const share of shares) {
        const target = findMergeTarget(candidates, {
          content: line.content,
          itemId: share.itemId,
        });

        if (!target && emptied && !reassigned) {
          reassigned = true;
          line.itemId = share.itemId;
          line.quantity = share.quantity;
          line.lastEditedByParticipantId = participantId;
          line.lastEditedAt = now;
          await lines.save(line);
          candidates.push(line);
          // Its origins stay where they are: the units did not leave the row.
          continue;
        }

        let destination: GeneratedListLine;
        if (target) {
          target.quantity += share.quantity;
          target.lastEditedByParticipantId = participantId;
          target.lastEditedAt = now;
          await lines.save(target);
          await this.union(manager, target, copied);
          // The reassigned original is reported as the answer's `line` and
          // announced there, so listing it here as well would draw one row
          // twice.
          if (target.id !== line.id && !merged.includes(target)) {
            merged.push(target);
          }
          destination = target;
        } else {
          this.checkRoom(basket.length + created.length);
          destination = await this.createSibling(manager, {
            line,
            share,
            position: positions.next(),
            participantId,
            now,
            options: copied,
          });
          created.push(destination);
          candidates.push(destination);
        }

        // Never for the reassigned original, whose units never left it: giving
        // to itself would move its own provenance rows onto itself and lower
        // them by the same number in the process.
        if (destination.id !== line.id) {
          await allocator.give(manager, destination, share.quantity);
        }
      }

      // Before the line is touched again, because a drained row is deleted here
      // and a folded line's remaining rows would otherwise be saved against an
      // id that is about to be gone.
      await allocator.flush(manager);

      const removed: string[] = [];
      if (emptied && !reassigned) {
        // Every share found a row of its own, so the original kept nothing: no
        // units, no settled history, and by now no origins either. It is folded
        // away rather than left as a row of zero, which is how moving every unit
        // back off a sibling ends.
        await this.foldAway(manager, line, merged, created);
        removed.push(line.id);
      } else if (!reassigned) {
        line.quantity = line.settledQuantity + balance;
        line.lastEditedByParticipantId = participantId;
        line.lastEditedAt = now;
        await lines.save(line);
      }

      return { line, created, merged, removed };
    });
  }

  /**
   * A sibling: the original copied, with the share's product and units (section
   * 3).
   *
   * `createdByParticipantId` is the original's and not the actor's. The person
   * who put milk here put this milk here, and the row that says who to ask about
   * a line nobody recognises must not become the person who chose a brand.
   */
  private async createSibling(
    manager: EntityManager,
    args: {
      line: GeneratedListLine;
      share: GeneratedListLineShare;
      position: number;
      participantId: string;
      now: Date;
      options: readonly GeneratedListLineOption[];
    }
  ): Promise<GeneratedListLine> {
    const lines = manager.getRepository(GeneratedListLine);
    const sibling = await lines.save(
      lines.create({
        generatedListId: args.line.generatedListId,
        content: args.line.content,
        quantity: args.share.quantity,
        settledQuantity: 0,
        itemId: args.share.itemId,
        origin: args.line.origin,
        targetListId: args.line.targetListId,
        position: args.position,
        createdByParticipantId: args.line.createdByParticipantId,
        lastEditedByParticipantId: args.participantId,
        lastEditedAt: args.now,
      })
    );
    if (args.options.length > 0) {
      await manager.getRepository(GeneratedListLineOption).insert(
        args.options.map((option, index) => ({
          generatedListLineId: sibling.id,
          itemId: option.itemId,
          position: index,
        }))
      );
    }
    return sibling;
  }

  /**
   * The options a merge target does not already offer (section 5.2).
   *
   * A union rather than a replacement: the target's own set is what its own
   * origins contributed, and dropping it would take products off a row somebody
   * else is looking at.
   */
  private async union(
    manager: EntityManager,
    target: GeneratedListLine,
    incoming: readonly GeneratedListLineOption[]
  ): Promise<void> {
    if (incoming.length === 0) {
      return;
    }
    const options = manager.getRepository(GeneratedListLineOption);
    const held = await options.find({
      where: { generatedListLineId: target.id },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const known = new Set(held.map((row) => row.itemId));
    const missing = incoming.filter((row) => !known.has(row.itemId));
    if (missing.length === 0) {
      return;
    }
    await options.insert(
      missing.map((row, index) => ({
        generatedListLineId: target.id,
        itemId: row.itemId,
        position: held.length + index,
      }))
    );
  }

  /**
   * A line that kept nothing, folded onto the row its units went to (section
   * 5.2).
   *
   * Its origins have already been moved by the allocator, so what is left to
   * carry is its settlement rows, standing and waiting alike: they re-point
   * their `generatedListLineId` so a reopen finds them, exactly as a merge does.
   * The survivor is the earliest by position of the rows this act wrote to,
   * which is the same rule an ordinary merge follows.
   */
  private async foldAway(
    manager: EntityManager,
    line: GeneratedListLine,
    merged: readonly GeneratedListLine[],
    created: readonly GeneratedListLine[]
  ): Promise<void> {
    const survivor = [...merged, ...created].sort(
      (a, b) => a.position - b.position
    )[0];
    if (survivor) {
      const lines = manager.getRepository(GeneratedListLine);
      await manager
        .getRepository(LineSettlement)
        .update(
          { generatedListLineId: line.id },
          { generatedListLineId: survivor.id }
        );
      if (survivor.position > line.position) {
        // Section 5.2 keeps the **earlier** line, and the row disappearing here
        // is the earlier one: a sibling raised by the last of its units sits
        // below the line it came from. The id cannot be kept, since it is the
        // one being folded, so what is kept is where the shopper was looking.
        survivor.position = line.position;
        await lines.save(survivor);
      }
    }
    await manager.getRepository(GeneratedListLine).delete({ id: line.id });
  }

  /**
   * How many lines one basket may hold (plan 0055, section 7).
   *
   * The cap every write that puts a line in a basket satisfies, asked here per
   * sibling rather than once for the request: the count that matters is the one
   * after the merges, and a split that merges every share creates nothing at all.
   */
  private checkRoom(count: number): void {
    if (count >= GENERATED_LIST_LIMITS.maxLines) {
      throw new ValidationException(
        `a generated list can hold at most ${GENERATED_LIST_LIMITS.maxLines} lines`,
        { messageArgs: { field: 'shares' } }
      );
    }
  }

  // --- The origins -----------------------------------------------------------

  /**
   * The allocation rule (section 3.1), run **once, here**, rather than at every
   * settle.
   *
   * For each share in request order, and within it for the original's origins
   * oldest first, an origin gives units up to its own room, which is what it
   * contributed less what this basket has already bought against it. The
   * destination gets an origin row per origin it drew from, with that many
   * units, the same `lineId`, `listId`, `zoneId` and `lineVersion`; the
   * original's row is lowered by the same number and dropped when it reaches
   * zero with nothing settled against it.
   *
   * **The excess case cannot arise.** Shares sum to at most the outstanding, and
   * the outstanding of a line is at most the sum of its origins' room plus plan
   * 0056's extra, which stays on the original because it belongs to no origin.
   * A share that outruns the room therefore moves as units alone, which is the
   * honest answer for units no household ever asked for.
   */
  private async allocatorFor(
    manager: EntityManager,
    line: GeneratedListLine
  ): Promise<OriginAllocator> {
    const repo = manager.getRepository(GeneratedListLineOrigin);
    const rows = await repo.find({
      where: { generatedListLineId: line.id },
      // Oldest provenance first, which is `allocateOldestFirst`'s own order.
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const settled = await this.settledPerOrigin(manager, line.id);
    const room = new Map<string, number>();
    for (const row of rows) {
      room.set(
        row.id,
        Math.max(0, row.quantity - (settled.get(row.lineId) ?? 0))
      );
    }

    const drained: GeneratedListLineOrigin[] = [];

    return {
      give: async (
        inner: EntityManager,
        destination: GeneratedListLine,
        units: number
      ) => {
        const origins = inner.getRepository(GeneratedListLineOrigin);
        let left = units;
        for (const row of rows) {
          if (left === 0) {
            break;
          }
          const available = room.get(row.id) ?? 0;
          if (available === 0) {
            continue;
          }
          const take = Math.min(available, left);
          room.set(row.id, available - take);
          left -= take;
          row.quantity -= take;

          const existing = await origins.findOne({
            where: {
              generatedListLineId: destination.id,
              lineId: row.lineId,
            },
          });
          if (existing) {
            // Section 5.2: origin rows on the same zone line sum. The unique
            // constraint is per basket line, so a second row here would be
            // refused rather than merged.
            existing.quantity += take;
            await origins.save(existing);
          } else {
            await origins.save(
              origins.create({
                generatedListLineId: destination.id,
                zoneId: row.zoneId,
                listId: row.listId,
                lineId: row.lineId,
                quantity: take,
                lineVersion: row.lineVersion,
              })
            );
          }

          if (row.quantity === 0 && (settled.get(row.lineId) ?? 0) === 0) {
            drained.push(row);
          }
        }
      },
      flush: async (inner: EntityManager) => {
        const origins = inner.getRepository(GeneratedListLineOrigin);
        const gone = new Set(drained.map((row) => row.id));
        const kept = rows.filter((row) => !gone.has(row.id));
        if (kept.length > 0) {
          await origins.save(kept);
        }
        if (gone.size > 0) {
          await origins.delete({ id: In([...gone]) });
        }
      },
    };
  }

  /**
   * What this basket has already bought against each of the line's origins.
   *
   * `BOUGHT` only, and reverted rows excluded, which is the floor plan 0057
   * section 5.2 computes: a shop that did not have the milk cannot raise it, and
   * a purchase somebody took back is history rather than a fact about any list.
   * A waiting row belongs to no origin (plan 0093, section 2.2) and is skipped,
   * or the floor would gain a key of `null`.
   */
  private async settledPerOrigin(
    manager: EntityManager,
    generatedListLineId: string
  ): Promise<Map<string, number>> {
    const rows = await manager.getRepository(LineSettlement).find({
      where: { generatedListLineId, outcome: SettlementOutcome.BOUGHT },
    });
    const perLine = new Map<string, number>();
    for (const row of rows) {
      if (row.lineId === null || row.revertedAt !== null) {
        continue;
      }
      perLine.set(row.lineId, (perLine.get(row.lineId) ?? 0) + row.quantity);
    }
    return perLine;
  }

  // --- Checks ----------------------------------------------------------------

  /**
   * Section 2.1's table, less the two the state answers.
   *
   * A share of **zero** is folded out before anything else rather than refused:
   * a client drawing a stepper per option sends every option it drew, and
   * refusing the untouched ones would make an ordinary screen build a request by
   * hand. A share naming the line's **own** product is refused, because that is
   * the balance, and naming it twice says two things.
   */
  private checkShares(
    shares: readonly GeneratedListLineShare[] | undefined,
    line: GeneratedListLine
  ): GeneratedListLineShare[] {
    const kept: GeneratedListLineShare[] = [];
    for (const share of shares ?? []) {
      if (
        !Number.isInteger(share.quantity) ||
        share.quantity < 0 ||
        share.quantity > GENERATED_LIST_LIMITS.maxQuantity
      ) {
        throw new ValidationException(
          `a quantity must be a whole number of at most ${GENERATED_LIST_LIMITS.maxQuantity}`,
          { messageArgs: { field: 'shares' } }
        );
      }
      if (share.quantity === 0) {
        continue;
      }
      if (share.itemId === line.itemId) {
        throw new ValidationException(
          'That product is the one this line already names',
          { messageArgs: { field: 'shares' } }
        );
      }
      kept.push({ itemId: share.itemId, quantity: share.quantity });
    }
    return kept;
  }

  /**
   * Every share names one of the line's **own** options, which is `resolvePick`'s
   * rule unchanged: a swap is only ever to an option.
   *
   * Without it this write would repoint any line at any product in the catalog.
   * A free text line has no options at all and lands here too, which is the right
   * answer: it has no product identity, so it has nothing to split by.
   */
  private async checkOptions(
    line: GeneratedListLine,
    shares: readonly GeneratedListLineShare[]
  ): Promise<void> {
    const wanted = [...new Set(shares.map((share) => share.itemId))];
    const offered = await this.options.find({
      where: { generatedListLineId: line.id, itemId: In(wanted) },
    });
    const known = new Set(offered.map((row) => row.itemId));
    if (wanted.some((itemId) => !known.has(itemId))) {
      throw new ValidationException(
        'That product is not one of this line’s options',
        { messageArgs: { field: 'shares' } }
      );
    }
  }

  // --- The answer ------------------------------------------------------------

  /**
   * The four collections, and what the room hears (section 6).
   *
   * Every announcement waits for the commit, which is the convention everywhere
   * in core: an event for a write that then rolled back is a client showing
   * something that never happened. Each is redacted to the least privileged
   * reader in the room, because a broadcast cannot be projected per socket.
   */
  private async answer(
    list: GeneratedList,
    applied: AppliedSplit,
    seesZoneData: boolean
  ): Promise<SplitGeneratedListLineResult> {
    const folded = applied.removed.includes(applied.line.id);
    const created = await this.viewsOf(applied.created, seesZoneData);
    const merged = await this.viewsOf(applied.merged, seesZoneData);

    for (const row of applied.merged) {
      const announcement: GeneratedListLineMovedEvent = {
        generatedListId: list.id,
        line: await this.generated.basketLineViewFor(row, false),
      };
      this.events.emitToGeneratedList(
        RealtimeEvent.GeneratedListLineUpdated,
        list.id,
        announcement
      );
    }
    for (const row of applied.created) {
      // Its own event and not a second `lineUpdated`, because a client receiving
      // that one has to decide whether to replace a row or append one (plan
      // 0055, section 8).
      const announcement: GeneratedListLineAddedEvent = {
        generatedListId: list.id,
        line: await this.generated.basketLineViewFor(row, false),
      };
      this.events.emitToGeneratedList(
        RealtimeEvent.GeneratedListLineAdded,
        list.id,
        announcement
      );
    }
    if (!folded) {
      const announcement: GeneratedListLineMovedEvent = {
        generatedListId: list.id,
        line: await this.generated.basketLineViewFor(applied.line, false),
      };
      this.events.emitToGeneratedList(
        RealtimeEvent.GeneratedListLineUpdated,
        list.id,
        announcement
      );
    } else {
      // The basket changed shape, which is what `deleteLine` announces today:
      // there is no line removed event on the room, and the whole basket view is
      // the owner's shape rather than a redacted one, so it goes to the owner
      // alone exactly as that write sends it. Every participant learns the same
      // thing from the answer's `removed`.
      this.events.emitToUsers(
        RealtimeEvent.GeneratedListUpdated,
        [list.ownerUserId],
        await this.generated.viewFor(list)
      );
    }

    return {
      line: folded
        ? // A folded original is gone, so the row this answer is "about" is the
          // one its units went to. The client removes the old id and redraws
          // that one, which is the same pair of facts either way.
          (merged[0] ?? created[0])
        : await this.generated.basketLineViewFor(applied.line, seesZoneData),
      created,
      merged,
      removed: applied.removed,
    };
  }

  private async viewsOf(
    rows: readonly GeneratedListLine[],
    seesZoneData: boolean
  ): Promise<GeneratedListBasketLineView[]> {
    const views: GeneratedListBasketLineView[] = [];
    for (const row of [...rows].sort((a, b) => a.position - b.position)) {
      views.push(await this.generated.basketLineViewFor(row, seesZoneData));
    }
    return views;
  }

  // --- Shared helpers --------------------------------------------------------

  /**
   * Where the siblings sit: the midpoint between the original (or the last
   * sibling this act created) and the next line, so they sit directly under the
   * original in share order and **nothing else moves**.
   *
   * A reorder would be the obvious alternative and is the wrong one: it rewrites
   * every row of a basket four people are looking at to place two.
   */
  private positionsAfter(
    basket: readonly GeneratedListLine[],
    line: GeneratedListLine
  ): { next: () => number } {
    const after = basket.find((row) => row.position > line.position);
    const ceiling = after ? after.position : line.position + 1;
    let previous = line.position;
    return {
      next: () => {
        const position = (previous + ceiling) / 2;
        previous = position;
        return position;
      },
    };
  }

  /**
   * The basket and what this participant may see of it.
   *
   * `seesZoneData` is asked here rather than taken from the gateway's context,
   * even though the guard has just computed it: plan 0051 section 5.2 insists the
   * question is answered at request time from core's own access tables, and a
   * value that travelled through a message is a value a future caller could send.
   */
  private async resolve(req: {
    generatedListId: string;
    participantId: string;
  }): Promise<{ list: GeneratedList; seesZoneData: boolean }> {
    const list = await this.lists.findOne({
      where: { id: req.generatedListId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }
    const participant = await this.sharing.liveParticipantById(
      req.participantId,
      list.id
    );
    if (!participant) {
      throw new UnauthorizedException('Not a participant of this basket');
    }
    return {
      list,
      seesZoneData: await this.sharing.seesZoneData(participant),
    };
  }
}

/** What the transaction did, before any of it is announced or drawn. */
interface AppliedSplit {
  line: GeneratedListLine;
  created: GeneratedListLine[];
  merged: GeneratedListLine[];
  removed: string[];
}

/**
 * The origin half of one split, kept as a closure over the rows it is moving.
 *
 * A closure rather than a pair of methods, because the room each origin has left
 * is carried **across** shares: an origin emptied by the first share has nothing
 * for the second, and recomputing per share would give the same units away
 * twice.
 */
interface OriginAllocator {
  give(
    manager: EntityManager,
    destination: GeneratedListLine,
    units: number
  ): Promise<void>;
  flush(manager: EntityManager): Promise<void>;
}
