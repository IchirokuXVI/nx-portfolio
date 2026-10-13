import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  ListPermission,
  ParticipantKind,
  type BasketLineMergeRequiredDetails,
  type BasketRowResult,
  type LineWriteVia,
  type RenameBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  ForbiddenException,
  LineMergeRequiredException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, type EntityManager } from 'typeorm';
import { BasketSharingService } from '../baskets/basket-sharing.service';
import { Zone } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  LineService,
  type ListRenameOutcome,
  type ListRenamePlan,
} from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { type BasketRow } from './basket-row-resolver';
import {
  BasketWriteContext,
  type OpenBasketWrite,
} from './basket-write.context';

/**
 * Renaming a row, and every list line it is made of (plan 0136, section 5.5).
 *
 * It keeps the whole of plan 0113's machinery and loses the basket half of it.
 * That plan renamed a basket line and the zone lines behind it, and then had to
 * fold two **basket** lines together when the new name collided inside the
 * basket. There are no basket lines any more, so that half is gone: two rows
 * that end up sharing a name are one row on the next read, by the key of the
 * row, with nothing to fold.
 *
 * ## Only a row with no product has a name to change (plan 0201, section 4)
 *
 * A row with a product is named by the catalog. Renaming one of its lines
 * would change what a household calls a thing and change nothing on the screen
 * the gesture was made on. So a named line that holds a product is refused,
 * with `validation_failed`, before anything is locked.
 *
 * ## The rule is plan 0113's, with "every origin" read as "every entry"
 *
 * The actor holds `WRITE` on every entry's list, themselves. A rename changes
 * what a household calls a thing, on that household's own list, so it is not a
 * delegated write and the owner's access does not stand in for it. A guest
 * cannot rename at all: they hold no list.
 *
 * ## Every refusal comes before any write
 *
 * The lists are locked in ascending id order, every list's rename is planned,
 * and **one** confirmation covers every collision across every list. A rename
 * that is refused writes nothing, which is what `confirmMerge` is a bargain
 * about: the client is told what it would merge and asks again.
 */
@Injectable()
export class BasketRowRenameService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: BasketWriteContext,
    private readonly zoneLines: LineService,
    private readonly listAccess: ListAccessService,
    private readonly sharing: BasketSharingService,
    private readonly events: CoreEventsPublisher
  ) {}

  async rename(req: RenameBasketRowRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new BasketFinishedException(
        'This basket is finished, so its rows cannot be renamed'
      );
    }
    if (
      opened.participant.kind === ParticipantKind.GUEST ||
      !opened.participant.userId
    ) {
      throw new ForbiddenException('A guest cannot rename a row');
    }

    // The lines the request names, and no others (plan 0201, section 4).
    const row = await opened.row(req.rowKey, req.lineIds);
    if (row.entries.some((entry) => entry.itemIds.length > 0)) {
      throw new ValidationException(
        'A line that has a product is named by its product',
        { messageArgs: { field: 'lineIds' } }
      );
    }
    const listIds = [
      ...new Set(row.entries.map((entry) => entry.listId)),
    ].sort();
    const permissions = await this.authorize(
      opened.participant.userId,
      listIds
    );

    const outcomes = await this.dataSource.transaction((manager) =>
      this.write(manager, row, req, permissions, opened.via())
    );

    for (const outcome of outcomes) {
      this.zoneLines.announceListRename(outcome);
    }
    // No announcement of its own (plan 0139, section 3): `announceListRename`
    // above makes one per list it renamed, naming the lines that went and the
    // lines that stayed, which is more than this site could reconstruct.
    const lineIds = row.entries.map((entry) => entry.lineId);
    return this.answer(opened, lineIds);
  }

  /**
   * `WRITE` on every list, and the whole permission set of each.
   *
   * The set and not only the answer, because `planListRename` branches on
   * `DECIDE` and `MANAGE`: a rename that merges two approved lines is a change
   * to what the group agreed to, and plan 0112 decides who may make it.
   */
  private async authorize(
    userId: string,
    listIds: readonly string[]
  ): Promise<Map<string, ReadonlySet<ListPermission>>> {
    const writable = await this.sharing.writableAmong(userId, listIds);
    if (!listIds.every((listId) => writable.has(listId))) {
      throw new ForbiddenException(
        'You need write access to every list this row comes from'
      );
    }
    const permissions = new Map<string, ReadonlySet<ListPermission>>();
    for (const listId of listIds) {
      const resolved = await this.listAccess.resolve(listId, userId);
      permissions.set(listId, resolved.permissions);
    }
    return permissions;
  }

  /** The lock, the plans, the one confirmation, and then the writes. */
  private async write(
    manager: EntityManager,
    row: BasketRow,
    req: RenameBasketRowRequest,
    permissions: ReadonlyMap<string, ReadonlySet<ListPermission>>,
    via: LineWriteVia
  ): Promise<ListRenameOutcome[]> {
    const listIds = [...permissions.keys()].sort();
    // Ascending id order, one order for every caller, so two renames over two
    // overlapping sets of lists wait for each other instead of deadlocking.
    const locked = await this.zoneLines.lockListsForRename(manager, listIds);

    const plans: ListRenamePlan[] = [];
    for (const [listId, shoppingList] of locked) {
      const lineIds = row.entries
        .filter((entry) => entry.listId === listId)
        .map((entry) => entry.lineId);
      plans.push(
        await this.zoneLines.planListRename(
          manager,
          shoppingList,
          lineIds,
          req.content,
          permissions.get(listId) as ReadonlySet<ListPermission>,
          // Carried on the plan, so every step of every list records the one
          // person who renamed the row (plan 0138, section 4).
          {
            userId: via.userId,
            participantId: via.participantId,
            basketId: via.basketId,
          }
        )
      );
    }

    const collided = plans.filter((plan) => plan.collision !== null);
    if (collided.length > 0 && req.confirmMerge !== true) {
      // **Every refusal first, and one confirmation for all of them.** A client
      // asked once about three lists rather than three times about one, and
      // nothing was written while it decided.
      throw await this.mergeRequired(manager, req.content, collided);
    }

    const outcomes: ListRenameOutcome[] = [];
    for (const plan of plans) {
      outcomes.push(await this.zoneLines.writeListRename(manager, plan));
    }
    return outcomes;
  }

  /** What the client is told it would merge, so it can ask the person. */
  private async mergeRequired(
    manager: EntityManager,
    content: string,
    collided: readonly ListRenamePlan[]
  ): Promise<LineMergeRequiredException> {
    const zoneIds = [...new Set(collided.map((plan) => plan.list.zoneId))];
    const zones = await manager.getRepository(Zone).find({
      where: { id: In(zoneIds) },
      select: { id: true, name: true },
    });
    const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
    const details: BasketLineMergeRequiredDetails = {
      lists: collided.map((plan) => ({
        listId: plan.list.id,
        listName: plan.list.name,
        zoneName: zoneNames.get(plan.list.zoneId) ?? '',
        otherContent: plan.collision?.otherContent ?? '',
        otherQuantity: plan.collision?.otherQuantity ?? 0,
      })),
      // Always null since plan 0136. The field described a collision **inside
      // the basket**, between two basket lines, and a basket holds no lines to
      // collide: two rows that end up sharing a name are one row on the next
      // read, by the merge key. It stays on the shape so a client still reading
      // it keeps parsing.
      basket: null,
    };
    return new LineMergeRequiredException(
      `the name "${content}" is already taken on a list this row comes from`,
      { details: { ...details }, messageArgs: { content } }
    );
  }

  /**
   * The named lines as they are now.
   *
   * A rename can fold a line into another line of its own list, and the line
   * that was folded away is then absent from the answer. It can also put the
   * lines in the row another name already anchors, because the key of a row
   * with no product is its normalized text. The client sees both from the
   * entries, and reads the basket for the row they joined.
   */
  private answer(
    opened: OpenBasketWrite,
    lineIds: readonly string[]
  ): Promise<BasketRowResult> {
    return opened.result(lineIds);
  }
}
