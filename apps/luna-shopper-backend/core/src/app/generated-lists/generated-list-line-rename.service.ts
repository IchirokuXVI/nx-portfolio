import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_LIMITS,
  isLiveGeneratedList,
  ParticipantKind,
  RealtimeEvent,
  type BasketLineMergeRequiredDetails,
  type GeneratedListLineMovedEvent,
  type GeneratedListLineRemovedEvent,
  type ListPermission,
  type RenameGeneratedListBasketLineRequest,
  type RenameGeneratedListBasketLineResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  GeneratedListFinishedException,
  LineMergeRequiredException,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  GeneratedListParticipant,
  LineSettlement,
  ShoppingList,
  Zone,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { normalizeContent } from '../lists/line-content';
import { isEarlierLine } from '../lists/line-merge.service';
import {
  LineService,
  type ListRenameOutcome,
  type ListRenamePlan,
} from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { checkContent } from './basket-line-limits';
import { findMergeTarget } from './basket-merge';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';

/** What a rename is asked to do, by either route. */
export interface BasketLineRename {
  list: GeneratedList;
  lineId: string;
  /** The actor. The owner's route passes the owner's own participant row. */
  participant: GeneratedListParticipant;
  content: string;
  confirmMerge: boolean;
}

/** What a rename did, before it is projected for anybody. */
export interface BasketLineRenamed {
  /** The surviving basket line, read again after the commit. */
  line: GeneratedListLine;
  /** The basket line a merge deleted, when there was one. */
  absorbedLineId?: string;
}

/** Everything the transaction decided and wrote, for the announcements after it. */
interface Written {
  outcomes: ListRenameOutcome[];
  survivorId: string;
  absorbedLineId?: string;
}

/**
 * Renaming a basket line renames its lines (plan 0113).
 *
 * ## The rule
 *
 * A basket line's name used to be the basket's alone: the zone lines it came
 * from kept the old name, and the next basket brought the old name back. Now a
 * rename writes the basket line **and every zone line it came from**, or none
 * of them, in one transaction. So it is allowed only to somebody who could have
 * made each of those zone renames themselves:
 *
 * - **A guest never.** A guest holds no access to any list.
 * - **A line with origins**: an account holding `WRITE` on every origin list,
 *   the owner included. Writing some of them and not all is refused whole.
 * - **A line with no origin** writes no list, and only the owner renames it,
 *   because a basket line is otherwise the owner's to edit.
 *
 * ## Nothing is written until every refusal has been asked
 *
 * The basket line is locked first, then the basket line its new name would
 * merge into, then every origin list in ascending id order. Under those locks
 * each list's rename is planned by `LineService.planListRename`, which asks plan
 * 0112's two refusals with the list's name, and the basket collision is found by
 * the basket merge rule (plan 0094, section 5). Only when every list and the
 * basket have answered does anything get written, and a collision without
 * `confirmMerge` is refused with every list and the basket line named in one
 * `line_merge_required`, so one confirmation covers every merge.
 *
 * ## What each reader hears
 *
 * Each list room hears plan 0112's events for its own lines. The basket room
 * hears the surviving line projected for a guest, because a room broadcast
 * cannot be projected per socket, and the removal of an absorbed line as an id.
 * The owner's own sessions hear the line as the owner's surface draws it, which
 * is what they hear for any basket line edit.
 */
@Injectable()
export class GeneratedListLineRenameService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly lines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOrigin)
    private readonly origins: Repository<GeneratedListLineOrigin>,
    @InjectRepository(ShoppingList)
    private readonly shoppingLists: Repository<ShoppingList>,
    private readonly zoneLines: LineService,
    private readonly listAccess: ListAccessService,
    private readonly sharing: GeneratedListSharingService,
    private readonly generated: GeneratedListService,
    private readonly events: CoreEventsPublisher
  ) {}

  /** The participant route (plan 0113, section 7). */
  async renameAsParticipant(
    req: RenameGeneratedListBasketLineRequest
  ): Promise<RenameGeneratedListBasketLineResult> {
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
      throw new ForbiddenException('Not a participant of this basket');
    }

    const renamed = await this.rename({
      list,
      lineId: req.lineId,
      participant,
      content: req.content,
      confirmMerge: req.confirmMerge === true,
    });

    // Projected as the basket read projects it, asked of core's own tables at
    // request time (plan 0051, section 5.2).
    const seesZoneData = await this.sharing.seesZoneData(participant);
    const line = await this.generated.basketLineViewFor(
      renamed.line,
      seesZoneData
    );
    return renamed.absorbedLineId === undefined
      ? { line }
      : { line, absorbedLineId: renamed.absorbedLineId };
  }

  /**
   * Rename one basket line, for either route.
   *
   * The owner's `PATCH :id/lines/:lineId` calls this with the owner's own
   * participant row when it carries `content`, so there is one rename rule.
   */
  async rename(input: BasketLineRename): Promise<BasketLineRenamed> {
    const { list, participant } = input;
    const content = checkContent(input.content);
    const line = await this.lines.findOne({
      where: { id: input.lineId, generatedListId: list.id },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    const listIds = await this.originListIds(
      (
        await this.origins.find({ where: { generatedListLineId: line.id } })
      ).map((origin) => origin.listId)
    );
    const permissions = await this.authorize(participant, listIds);

    if (!isLiveGeneratedList(list.status)) {
      throw new GeneratedListFinishedException(
        'This basket is finished, so its lines cannot be renamed'
      );
    }
    if (content === line.content) {
      // The name as it already stands is not a rename. Nothing is written and
      // nobody hears anything.
      return { line };
    }

    const written = await this.dataSource.transaction((manager) =>
      this.write(manager, {
        list,
        lineId: line.id,
        participant,
        content,
        confirmMerge: input.confirmMerge,
        permissions,
      })
    );

    // Read again after the commit rather than answering from an entity the
    // transaction held: the merges moved origins, options and settlements
    // underneath it.
    const survivor = await this.lines.findOne({
      where: { id: written.survivorId },
    });
    if (!survivor) {
      throw new NotFoundException('Line not found');
    }
    await this.announce(list, survivor, written);
    return written.absorbedLineId === undefined
      ? { line: survivor }
      : { line: survivor, absorbedLineId: written.absorbedLineId };
  }

  /**
   * Who may rename this line (plan 0113, section 2), asked before any lock is
   * taken and asked again of the origins once it is.
   *
   * Answers each origin list's permission set, because a zone rename decides a
   * merge's approval from it (plan 0112, section 2) and a `WRITE` answer alone
   * cannot say whether the caller also decides.
   */
  private async authorize(
    participant: GeneratedListParticipant,
    listIds: readonly string[]
  ): Promise<Map<string, ReadonlySet<ListPermission>>> {
    if (participant.kind === ParticipantKind.GUEST || !participant.userId) {
      throw new ForbiddenException('A guest cannot rename a line');
    }
    if (listIds.length === 0) {
      if (participant.kind !== ParticipantKind.OWNER) {
        throw new ForbiddenException(
          'Only the owner can rename a line that is on no list'
        );
      }
      return new Map();
    }
    const writable = await this.sharing.writableAmong(
      participant.userId,
      listIds
    );
    if (!listIds.every((listId) => writable.has(listId))) {
      throw new ForbiddenException(
        'You need write access to every list this line came from'
      );
    }
    const permissions = new Map<string, ReadonlySet<ListPermission>>();
    for (const listId of listIds) {
      const resolved = await this.listAccess.resolve(
        listId,
        participant.userId
      );
      permissions.set(listId, resolved.permissions);
    }
    return permissions;
  }

  /**
   * The distinct origin lists that still exist, in ascending id order.
   *
   * An origin carries no foreign key (plan 0050, section 1), so a list can be
   * deleted underneath a basket. A deleted list has no line to rename and no
   * access to ask about, so it takes no part in the rename.
   */
  private async originListIds(
    listIds: readonly string[],
    manager?: EntityManager
  ): Promise<string[]> {
    const distinct = [...new Set(listIds)];
    if (distinct.length === 0) {
      return [];
    }
    const repo = manager
      ? manager.getRepository(ShoppingList)
      : this.shoppingLists;
    const existing = await repo.find({
      where: { id: In(distinct) },
      select: { id: true },
    });
    return existing.map((row) => row.id).sort();
  }

  /** Sections 4 and 5, inside the one transaction. */
  private async write(
    manager: EntityManager,
    args: {
      list: GeneratedList;
      lineId: string;
      participant: GeneratedListParticipant;
      content: string;
      confirmMerge: boolean;
      permissions: Map<string, ReadonlySet<ListPermission>>;
    }
  ): Promise<Written> {
    const { list, participant, content, permissions } = args;
    const basketLines = manager.getRepository(GeneratedListLine);

    // 1. The basket line.
    const line = await basketLines.findOne({
      where: { id: args.lineId, generatedListId: list.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!line) {
      throw new NotFoundException('Line not found');
    }

    // 2. The basket line the new name merges into, when the name is new.
    const other = await this.basketCollision(manager, line, content);

    // The origins again, now that the line is held, since a list can have been
    // raised for it since the check outside. A list the caller was not
    // authorized for is refused rather than skipped.
    const origins = await manager
      .getRepository(GeneratedListLineOrigin)
      .find({ where: { generatedListLineId: line.id }, order: { id: 'ASC' } });
    const listIds = await this.originListIds(
      origins.map((origin) => origin.listId),
      manager
    );
    if (
      listIds.some((listId) => !permissions.has(listId)) ||
      (listIds.length === 0 && participant.kind !== ParticipantKind.OWNER)
    ) {
      throw new ForbiddenException(
        'This line came from another list since you opened it'
      );
    }

    // 3. Every origin list, in ascending id order, and each list's plan.
    const locked = await this.zoneLines.lockListsForRename(manager, listIds);
    const plans: ListRenamePlan[] = [];
    for (const [listId, shoppingList] of locked) {
      const lineIds = [
        ...new Set(
          origins
            .filter((origin) => origin.listId === listId)
            .map((origin) => origin.lineId)
        ),
      ];
      plans.push(
        await this.zoneLines.planListRename(
          manager,
          shoppingList,
          lineIds,
          content,
          permissions.get(listId) as ReadonlySet<ListPermission>
        )
      );
    }

    const collided = plans.filter((plan) => plan.collision !== null);
    if ((collided.length > 0 || other) && !args.confirmMerge) {
      throw await this.mergeRequired(manager, content, collided, other);
    }

    // Section 5, step 1. The zone lines, list by list.
    const outcomes: ListRenameOutcome[] = [];
    for (const plan of plans) {
      outcomes.push(await this.zoneLines.writeListRename(manager, plan));
    }

    // Steps 3 and 4. The basket line, and the basket merge. The merge reads the
    // origins again itself, because step 1 moved origin rows (step 2).
    const now = new Date();
    line.content = content;
    line.lastEditedByParticipantId = participant.id;
    line.lastEditedAt = now;
    if (!other) {
      await basketLines.save(line);
      return { outcomes, survivorId: line.id };
    }
    const [survivor, absorbed] = isEarlierLine(line, other)
      ? [line, other]
      : [other, line];
    await this.mergeBasketLines(manager, survivor, absorbed, {
      participantId: participant.id,
      now,
    });
    return { outcomes, survivorId: survivor.id, absorbedLineId: absorbed.id };
  }

  /**
   * The other line of this basket the basket merge rule folds the renamed line
   * into, locked, or null (plan 0113, section 4).
   *
   * Only for a new name as the fold reads it: a change of case, accents or
   * spacing alone never collides, as on a zone line (plan 0112, section 2). The
   * candidate is locked and asked again, since it was read before the lock.
   */
  private async basketCollision(
    manager: EntityManager,
    line: GeneratedListLine,
    content: string
  ): Promise<GeneratedListLine | null> {
    if (normalizeContent(content) === normalizeContent(line.content)) {
      return null;
    }
    const basketLines = manager.getRepository(GeneratedListLine);
    const candidates = await basketLines.find({
      where: { generatedListId: line.generatedListId },
      order: { position: 'ASC', id: 'ASC' },
    });
    const found = findMergeTarget(
      candidates.filter((candidate) => candidate.id !== line.id),
      { content, itemId: line.itemId }
    );
    if (!found) {
      return null;
    }
    const other = await basketLines.findOne({
      where: { id: found.id },
      lock: { mode: 'pessimistic_write' },
    });
    return other && findMergeTarget([other], { content, itemId: line.itemId })
      ? other
      : null;
  }

  /** The one refusal that names every collision (plan 0113, section 4). */
  private async mergeRequired(
    manager: EntityManager,
    content: string,
    collided: readonly ListRenamePlan[],
    other: GeneratedListLine | null
  ): Promise<LineMergeRequiredException> {
    const zoneIds = [...new Set(collided.map((plan) => plan.list.zoneId))];
    const zones =
      zoneIds.length === 0
        ? []
        : await manager
            .getRepository(Zone)
            .find({
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
      basket: other
        ? {
            otherLineId: other.id,
            otherContent: other.content,
            otherQuantity: other.quantity,
          }
        : null,
    };
    return new LineMergeRequiredException(
      `the name "${content}" is already taken on a list this line came from or in this basket`,
      { details: { ...details }, messageArgs: { content } }
    );
  }

  /**
   * Two basket lines become one (plan 0113, section 5, step 4).
   *
   * Every row that references a basket line id moves before the absorbed line
   * is deleted, because each of them either cascades on that delete or would
   * point at nothing:
   *
   * | Rows                          | Key                                          | What moves                                                      |
   * | ----------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
   * | `generated_list_line_origins` | `generatedListLineId`, unique with `lineId`  | Update to the survivor. Two rows on one zone line become one.   |
   * | `generated_list_line_options` | `generatedListLineId`, unique with `itemId`  | The absorbed line's products the survivor lacks, appended.      |
   * | `line_settlements`            | `generatedListLineId`, no foreign key        | Update to the survivor, standing and waiting alike.             |
   *
   * The survivor keeps its own spelling, its position and its author. Its pick
   * stays, or takes the absorbed line's when it has none.
   */
  private async mergeBasketLines(
    manager: EntityManager,
    survivor: GeneratedListLine,
    absorbed: GeneratedListLine,
    edit: { participantId: string; now: Date }
  ): Promise<void> {
    const origins = manager.getRepository(GeneratedListLineOrigin);
    const moving = await origins.find({
      where: { generatedListLineId: absorbed.id },
      order: { id: 'ASC' },
    });
    const staying = await origins.find({
      where: { generatedListLineId: survivor.id },
    });
    const byZoneLine = new Map(
      staying.map((origin) => [origin.lineId, origin])
    );
    for (const origin of moving) {
      const shared = byZoneLine.get(origin.lineId);
      if (shared) {
        // Deleted first, so the pair never exists twice under the unique key.
        await origins.delete({ id: origin.id });
        shared.quantity += origin.quantity;
        await origins.update({ id: shared.id }, { quantity: shared.quantity });
      } else {
        await origins.update(
          { id: origin.id },
          { generatedListLineId: survivor.id }
        );
      }
    }

    await manager
      .getRepository(LineSettlement)
      .update(
        { generatedListLineId: absorbed.id },
        { generatedListLineId: survivor.id }
      );

    const options = manager.getRepository(GeneratedListLineOption);
    const order = { position: 'ASC', createdAt: 'ASC' } as const;
    const held = await options.find({
      where: { generatedListLineId: survivor.id },
      order,
    });
    const incoming = await options.find({
      where: { generatedListLineId: absorbed.id },
      order,
    });
    const known = new Set(held.map((row) => row.itemId));
    const missing = incoming.filter((row) => !known.has(row.itemId));
    if (missing.length > 0) {
      const top = held.reduce((max, row) => Math.max(max, row.position), -1);
      await options.insert(
        missing.map((row, index) => ({
          generatedListLineId: survivor.id,
          itemId: row.itemId,
          position: top + 1 + index,
        }))
      );
    }

    // Capped as every basket quantity is. The settled units are summed whole,
    // because they are purchases that happened and a cap would forget one.
    survivor.quantity = Math.min(
      survivor.quantity + absorbed.quantity,
      GENERATED_LIST_LIMITS.maxQuantity
    );
    survivor.settledQuantity += absorbed.settledQuantity;
    survivor.itemId ??= absorbed.itemId;
    survivor.lastEditedByParticipantId = edit.participantId;
    survivor.lastEditedAt = edit.now;

    const lines = manager.getRepository(GeneratedListLine);
    // Last, once nothing the absorbed line owned still points at it.
    await lines.delete({ id: absorbed.id });
    await lines.save(survivor);
  }

  /** Section 6, after the commit. */
  private async announce(
    list: GeneratedList,
    survivor: GeneratedListLine,
    written: Written
  ): Promise<void> {
    for (const outcome of written.outcomes) {
      this.zoneLines.announceListRename(outcome);
    }

    if (written.absorbedLineId !== undefined) {
      // First, so a client applying events in order never draws two lines of
      // one name.
      const removed: GeneratedListLineRemovedEvent = {
        generatedListId: list.id,
        lineId: written.absorbedLineId,
      };
      this.events.emitToGeneratedList(
        RealtimeEvent.GeneratedListLineRemoved,
        list.id,
        removed
      );
      this.events.emitToUsers(
        RealtimeEvent.GeneratedListLineRemoved,
        [list.ownerUserId],
        removed
      );
    }

    // The least privileged reader in the room is a guest (plan 0051, section
    // 5.2), so the room hears the line without origins, target or origin kind.
    const moved: GeneratedListLineMovedEvent = {
      generatedListId: list.id,
      line: await this.generated.basketLineViewFor(survivor, false),
    };
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListLineUpdated,
      list.id,
      moved
    );
    // The owner's own sessions, as for every other edit of a basket line.
    this.events.emitToUsers(
      RealtimeEvent.GeneratedListLineUpdated,
      [list.ownerUserId],
      {
        generatedListId: list.id,
        line: await this.generated.lineViewFor(survivor),
      }
    );
  }
}
