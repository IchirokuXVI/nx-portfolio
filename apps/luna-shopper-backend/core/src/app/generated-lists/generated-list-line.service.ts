import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_LIMITS,
  GeneratedLineOrigin,
  RealtimeEvent,
  type AddGeneratedListLineRequest,
  type GeneratedListLineIdRequest,
  type GeneratedListLineView,
  type GeneratedListView,
  type ReorderGeneratedListLinesRequest,
  type UpdateGeneratedListLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
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
import { GeneratedListService } from './generated-list.service';

/** Answered for a line that is not on the basket the request named. */
const NO_SUCH_LINE = 'Generated list line not found';

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
    const content = checkContent(req.content);
    const quantity = checkQuantity(req.quantity ?? 1);
    const target =
      req.targetListId === undefined
        ? list.defaultTargetListId
        : req.targetListId;

    await this.checkRoom(list.id);

    const position = await this.nextPosition(list.id);
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
      })
    );

    const optionIds = [...new Set(req.options ?? [])];
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
    const line = await this.loadLine(list.id, req.lineId);
    await this.lines.delete({ id: line.id });
    await this.announceList(req.userId, list);
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
   */
  private async promote(
    userId: string,
    line: GeneratedListLine,
    targetListId: string
  ): Promise<void> {
    const created = await this.zoneLines.add({
      userId,
      listId: targetListId,
      content: line.content,
      quantity: line.quantity,
      itemIds: line.itemId ? [line.itemId] : [],
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
        line.quantity,
        created.version,
      ]
    );
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

  private async nextPosition(generatedListId: string): Promise<number> {
    const max = await this.lines
      .createQueryBuilder('l')
      .select('COALESCE(MAX(l.position), 0)', 'max')
      .where('l."generatedListId" = :generatedListId', { generatedListId })
      .getRawOne<{ max: string }>();
    return Number(max?.max ?? 0) + 1;
  }

  private async checkRoom(generatedListId: string): Promise<void> {
    const count = await this.lines.count({ where: { generatedListId } });
    if (count >= GENERATED_LIST_LIMITS.maxLines) {
      throw new ValidationException(
        `a generated list can hold at most ${GENERATED_LIST_LIMITS.maxLines} lines`,
        { messageArgs: { field: 'content' } }
      );
    }
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

/** Trimmed and capped. An empty line is not a line. */
function checkContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new ValidationException('a line needs some text', {
      messageArgs: { field: 'content' },
    });
  }
  if (trimmed.length > GENERATED_LIST_LIMITS.contentMaxLength) {
    throw new ValidationException(
      `a line can be at most ${GENERATED_LIST_LIMITS.contentMaxLength} characters`,
      { messageArgs: { field: 'content' } }
    );
  }
  return trimmed;
}

/**
 * The bounds a basket line's quantity satisfies.
 *
 * Zero is allowed on an **edit** and not on an add, which mirrors the zone line
 * rule plan 0047 section 2.2 states: a line at zero is one the household knows
 * about and does not currently need, and adding a line you do not want is not a
 * gesture anybody makes.
 */
function checkQuantity(
  quantity: number,
  opts: { allowZero?: boolean } = {}
): number {
  const floor = opts.allowZero ? 0 : 1;
  if (!Number.isInteger(quantity) || quantity < floor) {
    throw new ValidationException(
      `a quantity must be a whole number of at least ${floor}`,
      { messageArgs: { field: 'quantity' } }
    );
  }
  if (quantity > GENERATED_LIST_LIMITS.maxQuantity) {
    throw new ValidationException(
      `a quantity can be at most ${GENERATED_LIST_LIMITS.maxQuantity}`,
      { messageArgs: { field: 'quantity' } }
    );
  }
  return quantity;
}
