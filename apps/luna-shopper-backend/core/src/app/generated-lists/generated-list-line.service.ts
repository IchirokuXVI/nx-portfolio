import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GeneratedLineOrigin,
  isLiveGeneratedList,
  RealtimeEvent,
  type AddGeneratedListLineRequest,
  type GeneratedListLineIdRequest,
  type GeneratedListLineView,
  type GeneratedListView,
  type LineView,
  type ReorderGeneratedListLinesRequest,
  type UpdateGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  GeneratedListFinishedException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import {
  checkContent,
  checkOptions,
  checkQuantity,
  checkRoom,
  nextPosition,
} from './basket-line-limits';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { LineClaimService } from './line-claim.service';

/** Answered for a line that is not on the basket the request named. */
const NO_SUCH_LINE = 'Generated list line not found';

/**
 * A finished basket refuses every write, the owner's included (plan 0059,
 * section 3.2). The owner's remedy is to unfinish it, which is one write and is
 * already built, rather than a special case that lets a finished trip be edited
 * while everybody else looks at a screen that disagrees with itself.
 *
 * Checked on the row the caller already holds, never re-read: every write here
 * loads the basket first, and a helper that fetched it again would add a query
 * per write to save three lines.
 */
function requireLive(list: GeneratedList): void {
  if (!isLiveGeneratedList(list.status)) {
    throw new GeneratedListFinishedException(
      'This basket is finished, so its lines cannot be edited'
    );
  }
}

/**
 * What a write back created: the zone line, the zone it landed in, and what it
 * asked for.
 *
 * Returned rather than kept, because plan 0058's caller has to tell the reader
 * whether the household still has to approve it, and that is a property of the
 * created line alone.
 */
export interface PromotedLine {
  line: LineView;
  zoneId: string;
  /** The units the zone line was created with, which the origin row records. */
  quantity: number;
}

/**
 * Editing a basket (plan 0050, section 5), and the one rule the whole plan turns
 * on:
 *
 * > An edit inside a generated list changes the shared zone lists **only** when
 * > the user has said which shared list should receive it.
 *
 * Every method here is local by default. The single exception is a `targetListId`
 * on an `ADDED` line, which the user set precisely to say "and put this in the
 * flat list too", and which goes through the ordinary {@link LineService.add}
 * path so it is subject to the ordinary rules: `WRITE` checked **at that moment**
 * rather than at generation time, and a new line that starts `PENDING` approval
 * like any other.
 *
 * The failure mode this exists to prevent is worth restating, because every
 * method here is one careless line away from it: a user tidies up their own
 * shopping list at the till and, without meaning to, rewrites a list four other
 * people depend on.
 *
 * ## The three things that are deliberately local
 *
 * - **Editing a `DERIVED` line.** Text and quantity change the generated copy
 *   alone. The zone line is untouched. The user asked for a shopping list, not
 *   for a way to rewrite other people's lists.
 * - **Deleting a `DERIVED` line.** It leaves the basket and the zone line stays
 *   wanted. That is the "I decided not to buy this today" gesture, and it must
 *   not look like "this is done", which is the same distinction plan 0047 section
 *   4 draws for a skipped settle.
 * - **Switching the pick.** It changes which product the basket means and what
 *   the next settlement records, and it never touches the zone line.
 */
@Injectable()
export class GeneratedListLineService {
  constructor(
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOption)
    private readonly options: Repository<GeneratedListLineOption>,
    private readonly generatedLists: GeneratedListService,
    private readonly listAccess: ListAccessService,
    private readonly zoneLines: LineService,
    private readonly claims: LineClaimService,
    // For the owner's participant row alone, which is what a line's authorship
    // is recorded as (plan 0055, section 4). Every actor on a basket is a
    // participant, including the owner adding a line from their laptop, so the
    // two attribution columns speak one vocabulary rather than two.
    private readonly sharing: GeneratedListSharingService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Type a line into a basket (plan 0050, section 5).
   *
   * It is created with `origin = ADDED` and lives in the basket alone, unless a
   * target list is named, either on the request or as the basket's
   * `defaultTargetListId`. An explicit null on the request beats the default,
   * which is what lets somebody keep one private line in a basket that is
   * otherwise being mirrored into a shared list.
   */
  async addLine(
    req: AddGeneratedListLineRequest
  ): Promise<GeneratedListLineView> {
    const list = await this.generatedLists.load(
      req.userId,
      req.generatedListId
    );
    requireLive(list);
    const content = checkContent(req.content);
    const quantity = checkQuantity(req.quantity ?? 1);
    const target =
      req.targetListId === undefined
        ? list.defaultTargetListId
        : req.targetListId;

    await checkRoom(this.lines, list.id);

    // The owner's own participant row, which exists from generation time and is
    // created here if this basket predates plan 0051. A line records its author
    // as a participant on both surfaces (plan 0055, section 4), so that null in
    // that column keeps meaning "the run composed this" and nothing else.
    const author = await this.sharing.ensureOwnerParticipant(list);

    const position = await nextPosition(this.lines, list.id);
    const line = await this.lines.save(
      this.lines.create({
        generatedListId: list.id,
        content,
        quantity,
        settledQuantity: 0,
        itemId: req.itemId ?? null,
        origin: GeneratedLineOrigin.ADDED,
        targetListId: null,
        position,
        createdByParticipantId: author.id,
      })
    );

    const optionIds = checkOptions(req.options);
    if (optionIds.length > 0) {
      await this.options.insert(
        optionIds.map((itemId, index) => ({
          generatedListLineId: line.id,
          itemId,
          position: index,
        }))
      );
    }

    if (target) {
      await this.promote(req.userId, line, target);
    }

    return this.announceLine(req.userId, list, line);
  }

  /**
   * Edit one basket line: its text, its quantity, its pick, or its target list.
   *
   * Everything but the last is local. Setting a `targetListId` on an `ADDED` line
   * that does not have one promotes it into that zone list, once: the promotion
   * is what the field means, so setting it twice does not create two lines, and
   * clearing it afterwards does not delete the line it created. A shared list is
   * not something a basket may take things back out of.
   */
  async updateLine(
    req: UpdateGeneratedListLineRequest
  ): Promise<GeneratedListLineView> {
    const list = await this.generatedLists.load(
      req.userId,
      req.generatedListId
    );
    requireLive(list);
    const line = await this.loadLine(list.id, req.lineId);

    if (req.content !== undefined) {
      line.content = checkContent(req.content);
    }
    if (req.quantity !== undefined) {
      line.quantity = checkQuantity(req.quantity, { allowZero: true });
    }
    if (req.itemId !== undefined) {
      line.itemId = await this.checkPick(line, req.itemId);
    }

    const promoting =
      req.targetListId !== undefined &&
      req.targetListId !== null &&
      line.targetListId === null;
    if (promoting) {
      if (line.origin !== GeneratedLineOrigin.ADDED) {
        // A DERIVED line is already in the lists its origins name. Giving it a
        // target would be asking a shared list for a second copy of a line it
        // already holds.
        throw new ValidationException(
          'only a line added to this basket can be sent to a shopping list',
          { messageArgs: { field: 'targetListId' } }
        );
      }
      await this.promote(req.userId, line, req.targetListId as string);
    }

    const saved = await this.lines.save(line);
    return this.announceLine(req.userId, list, saved);
  }

  /**
   * Take a line out of the basket.
   *
   * It removes the basket line and **leaves every origin exactly as it was**. The
   * zone line stays wanted, because "I decided not to buy this today" is not
   * "somebody bought this".
   */
  async deleteLine(req: GeneratedListLineIdRequest): Promise<{ id: string }> {
    const list = await this.generatedLists.load(
      req.userId,
      req.generatedListId
    );
    requireLive(list);
    const line = await this.loadLine(list.id, req.lineId);
    // Read before the delete, because the provenance rows cascade with it (plan
    // 0052, section 3.3). Taking a line out of the basket is the "I decided not
    // to buy this today" gesture, so the zone line goes back to nobody having
    // it, exactly as the zone line itself stays wanted.
    const refs = await this.claims.refsOfBasketLine(line.id);
    await this.lines.delete({ id: line.id });
    await this.announceList(req.userId, list);
    await this.claims.announceReleased(refs);
    return { id: line.id };
  }

  /**
   * Reorder the basket, which is a local edit like every other one here.
   *
   * The order a person walks a shop in is theirs, and it has nothing to say about
   * the order the zone lists are written in.
   */
  async reorderLines(
    req: ReorderGeneratedListLinesRequest
  ): Promise<GeneratedListView> {
    const list = await this.generatedLists.load(
      req.userId,
      req.generatedListId
    );
    requireLive(list);
    const lines = await this.lines.find({
      where: { generatedListId: list.id },
    });
    const known = new Set(lines.map((line) => line.id));
    if (
      req.lineIds.length !== lines.length ||
      req.lineIds.some((id) => !known.has(id))
    ) {
      // The whole basket or nothing: a partial order is not an order, and
      // accepting one would leave the lines it omitted at positions that no
      // longer mean anything.
      throw new ValidationException(
        'every line of the generated list must be given exactly once',
        { messageArgs: { field: 'lineIds' } }
      );
    }

    const byId = new Map(lines.map((line) => [line.id, line]));
    const reordered = req.lineIds.map((id, index) => {
      const line = byId.get(id) as GeneratedListLine;
      line.position = index + 1;
      return line;
    });
    await this.lines.save(reordered);
    return this.announceList(req.userId, list);
  }

  // --- The write back --------------------------------------------------------

  /**
   * Create an `ADDED` line in the zone list the user named (plan 0050, section
   * 5).
   *
   * Through {@link LineService.add} and not by an insert of our own, which is the
   * point: the caller must hold `WRITE` **at that moment**, the line starts
   * `PENDING` approval unless the list or the adder's permissions say otherwise
   * (plan 0037, section 2), and the ordinary `line.added` event reaches the zone
   * so everybody else sees it appear. A basket that wrote its own rows would have
   * to reimplement all three and would drift from the first one that changed.
   *
   * The created line becomes the basket line's provenance row, and the basket
   * line's `origin` **stays `ADDED`**, because the history worth recording is
   * that this came from a shop rather than from the list.
   *
   * Reachable from the participant surface since plan 0055 as the owner's
   * default target (section 3.2), which is their standing intent about their
   * **own** additions: a guest's line silently promoted into a household list
   * would be a zone write they cannot see, cannot explain and did not ask for.
   *
   * Since plan 0058 it is also how a named target reaches a list from the
   * basket, and that is what {@link userId} is for. It is the account whose
   * `WRITE` the add is checked against and whose name the created line carries,
   * so it is the **owner** on the two paths above and the **actor** when
   * somebody with an account binds a line: a household's list may name only
   * accounts, and the account that said which list is the honest author. The
   * owner's own access is checked by that caller separately, because it is the
   * owner's access that authorizes every later settle on the origin this writes.
   *
   * The created line is returned rather than discarded, for one field: whether
   * the list's ordinary rules approved it or left it `PENDING`. Nothing here
   * decides that (plan 0037) and nothing here overrides it; a caller that has to
   * tell a reader their line is waiting can only be told by the add itself.
   */
  async promote(
    userId: string,
    line: GeneratedListLine,
    targetListId: string,
    // The units to ask that list for, when they are not the basket line's own
    // quantity. Plan 0058 section 4.1 binds at what is **outstanding**, because
    // a line whose units are already bought would otherwise ask the household
    // for things that are in the cupboard. Zero is a legitimate value and is
    // plan 0047 section 2.2's line: known about, not currently wanted.
    options: { quantity?: number } = {}
  ): Promise<PromotedLine> {
    const quantity = options.quantity ?? line.quantity;
    // The add may answer a line the list already held rather than a new one
    // (plan 0091): a household that already asks for milk keeps one Milk, raised
    // by what this basket line contributed. The origin row below is written
    // against whichever line it landed on, with the units this promotion added
    // rather than that line total, so a settle allocates against what this list
    // actually asked for.
    const { line: created } = await this.zoneLines.add({
      userId,
      listId: targetListId,
      content: line.content,
      quantity,
      itemIds: await this.promotedItemIds(line),
    });
    const list = await this.listAccess.getList(targetListId);

    line.targetListId = targetListId;
    await this.lines.manager.getRepository(GeneratedListLine).save(line);
    await this.lines.manager.query(
      `INSERT INTO "generated_list_line_origins"
         ("generatedListLineId", "zoneId", "listId", "lineId", "quantity", "lineVersion")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT "uq_generated_list_line_origin" DO NOTHING`,
      [
        line.id,
        list.zoneId,
        targetListId,
        created.id,
        // The provenance row records what this list actually contributed, which
        // is the number the zone line was created with and not the basket
        // line's, or a settle would allocate against units nobody asked for.
        quantity,
        created.version,
      ]
    );

    return { line: created, zoneId: list.zoneId, quantity };
  }

  /**
   * The products a promoted line names (plan 0065).
   *
   * A basket line's product identity is two fields, not one: the pick, which is
   * the single product somebody means to buy today, and the option rows behind
   * it, which are what the line is **about**. A zone line's `itemIds` is a set
   * of candidates (plan 0007, a household wants milk rather than a SKU), which
   * is the same concept under another name in another service, so the promotion
   * carries the whole set rather than the pick alone.
   *
   * The pick leads where there is one, and that ordering is load bearing rather
   * than decorative: `GeneratedListService.resolvePick` takes `options[0]` when
   * a later run composes a basket from this list, so leading with the pick is
   * what makes the next trip default to the product this trip actually bought.
   *
   * The case this exists for is the ordinary one. A group suggestion attaches
   * its whole member set as options and leaves the pick null on purpose (plan
   * 0055, section 3), so that the row can still ask "which one did you get?" at
   * the shelf, and the dropdown leads with groups. Such a line used to reach a
   * household's list naming no product at all, which the client draws as `Not
   * linked to a product`. A line carrying a pick and no options is the shape
   * everything promoted before this plan, and it still promotes naming that one
   * product.
   *
   * There is no truncation branch and none should be invented: a basket line
   * holds at most `GENERATED_LIST_LIMITS.maxOptions`, which is 50, and a zone
   * line accepts `LINE_ITEM_SET_MAX`, which is 100, so the smaller cap always
   * fits inside the larger. Dropping products from a household's list with
   * nothing to say about it is not something this may do.
   */
  private async promotedItemIds(line: GeneratedListLine): Promise<string[]> {
    const options = await this.options.find({
      where: { generatedListLineId: line.id },
      order: { position: 'ASC' },
    });
    const itemIds = options.map((option) => option.itemId);
    if (!line.itemId) {
      return itemIds;
    }
    return [line.itemId, ...itemIds.filter((itemId) => itemId !== line.itemId)];
  }

  /**
   * Whether the pick names one of this line's options.
   *
   * A pick that is not an option is refused rather than accepted and quietly
   * added, because the options are what the run copied from the origins and a
   * settlement records the pick: letting an arbitrary id through would put a
   * product nobody offered into a household's purchase history. Null always
   * passes, and clears the pick.
   */
  private async checkPick(
    line: GeneratedListLine,
    itemId: string | null
  ): Promise<string | null> {
    if (itemId === null) {
      return null;
    }
    const option = await this.options.findOne({
      where: { generatedListLineId: line.id, itemId },
    });
    if (!option) {
      throw new ValidationException(
        'that product is not one of the options on this line',
        { messageArgs: { field: 'itemId' } }
      );
    }
    return itemId;
  }

  // --- Shared helpers --------------------------------------------------------

  private async loadLine(
    generatedListId: string,
    lineId: string
  ): Promise<GeneratedListLine> {
    const line = await this.lines.findOne({
      where: { id: lineId, generatedListId },
    });
    if (!line) {
      throw new NotFoundException(NO_SUCH_LINE);
    }
    return line;
  }

  /** One line changed: the owner's other devices hear it and nobody else does. */
  private async announceLine(
    userId: string,
    list: GeneratedList,
    line: GeneratedListLine
  ): Promise<GeneratedListLineView> {
    const view = await this.generatedLists.lineViewFor(line);
    this.events.emitToUsers(RealtimeEvent.GeneratedListLineUpdated, [userId], {
      generatedListId: list.id,
      line: view,
    });
    return view;
  }

  /** The basket changed shape: a line left it, or they all moved. */
  private async announceList(
    userId: string,
    list: GeneratedList
  ): Promise<GeneratedListView> {
    const view = await this.generatedLists.viewFor(list);
    this.events.emitToUsers(RealtimeEvent.GeneratedListUpdated, [userId], view);
    return view;
  }
}
