import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  RealtimeEvent,
  type AddLineRequest,
  type DeleteLineRequest,
  type LineOrder,
  type LinePage,
  type LineView,
  type ListLinesRequest,
  type ReorderLinesRequest,
  type SetLineApprovalRequest,
  type SetLineStatusRequest,
  type UpdateLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  Repository,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';
import { ListLine, ShoppingList } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ListAccessService } from './list-access.service';
import { toLineView } from './list.mappers';

interface LineCursor {
  order: LineOrder;
  value: string;
  id: string;
}

/** Canonical UUID shape, for validating the cross-service catalog `itemId`. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class LineService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ListLine) private readonly lines: Repository<ListLine>,
    private readonly listAccess: ListAccessService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Validate the optional catalog `itemId` (plan 0012, section 4). A line may
   * reference a catalog Item or be free text. The reference is cross service, so
   * only its shape is checked here (a UUID); its existence is the client's
   * concern and core never joins to the catalog database. `null` clears it.
   */
  private validateItemId(itemId: string | null): string | null {
    if (itemId === null) {
      return null;
    }
    if (!UUID_PATTERN.test(itemId)) {
      throw new ValidationException('itemId must be a valid item reference', {
        messageArgs: { field: 'itemId' },
      });
    }
    return itemId;
  }

  private emit(event: RealtimeEvent, zoneId: string, line: ListLine): void {
    this.events.emit(event, zoneId, toLineView(line), line.listId);
  }

  /**
   * Add a line (plan 0007, section 2). `WRITE`.
   *
   * ## The server decides whether it is already approved (plan 0037, section 2)
   *
   * Three rules, in this order:
   *
   * 1. **The adder holds `DECIDE`.** The line is created `APPROVED`, attributed
   *    to them. They are the person the approval was going to be asked of, and
   *    adding the line is them giving it. Group staff hold `DECIDE` on every
   *    list, which is what fixes the defect this plan opens with: a client that
   *    drew the two decision buttons on a line the adder had just typed, because
   *    the server had told it the line was awaiting the adder's own approval.
   * 2. **Otherwise the list has `autoApproveLines` set.** `APPROVED` with a
   *    **null** approver: nobody decided, the list is configured not to ask, and
   *    a null approver is the honest record of that.
   * 3. **Otherwise `PENDING`,** as before.
   *
   * The adder's own permission and not just the list option, because rule 2 alone
   * would not fix rule 1's defect: a group that wants approval, and therefore
   * leaves the option off, still does not want its admins approving their own
   * lines in a second step. Rule 1 is not a shortcut around approval, it is
   * approval, performed by the only person it could have been asked of.
   *
   * `status` is `PENDING` in all three cases. The two state machines stay
   * independent, which is the whole reason 0007 separated them: whether the group
   * agreed to buy a thing and whether it is in the trolley are different
   * questions, and auto approving the first answers nothing about the second.
   */
  async add(req: AddLineRequest): Promise<LineView> {
    const { list, permissions } = await this.listAccess.requireAccess(
      req.listId,
      req.userId,
      ListPermission.WRITE
    );
    const max = await this.lines
      .createQueryBuilder('l')
      .select('COALESCE(MAX(l.position), 0)', 'max')
      .where('l."listId" = :listId', { listId: req.listId })
      .getRawOne<{ max: number }>();

    const decides = permissions.has(ListPermission.DECIDE);
    const approved = decides || list.autoApproveLines;

    const saved = await this.lines.save(
      this.lines.create({
        listId: req.listId,
        content: req.content,
        quantity: this.validateQuantity(req.quantity ?? 1),
        itemId: this.validateItemId(req.itemId ?? null),
        position: Number(max?.max ?? 0) + 1,
        approvalStatus: approved
          ? LineApprovalStatus.APPROVED
          : LineApprovalStatus.PENDING,
        status: LineStatus.PENDING,
        createdByUserId: req.userId,
        approvedByUserId: decides ? req.userId : null,
        version: 1,
      })
    );
    this.emit(RealtimeEvent.LineAdded, list.zoneId, saved);
    return toLineView(saved);
  }

  /**
   * A quantity of at least one (plan 0037, section 4.4).
   *
   * The gateway DTO already says `@Min(1)`, and core says it again rather than
   * trusting the caller: core's callers are NATS messages, the gateway is one of
   * them rather than a wall, and a floor that only one of two layers enforces is
   * a floor that a second client, a replayed message or a future service can walk
   * straight through. "None of it was there" is `NOT_AVAILABLE` on the whole
   * line, which is a control the same caller already has.
   */
  private validateQuantity(quantity: number): number {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationException('quantity must be at least 1', {
        messageArgs: { field: 'quantity' },
      });
    }
    return quantity;
  }

  /**
   * Edit a line (plan 0007, section 2; plan 0036, section 4.1; plan 0037,
   * section 4). Bumps version.
   *
   * ## Three different answers about who may touch a line
   *
   * - **`MANAGE` may edit any field of any line**, whatever its approval. A list
   *   admin governs the list, and a governed thing needs somebody who can fix it:
   *   a line approved with a typo in it, an item the group agreed to that turns
   *   out to be the wrong one.
   * - **`WRITE` covers `PENDING` and `REJECTED` lines only.** A writer whose line
   *   has been agreed to cannot quietly change what was agreed to.
   * - **`DECIDE` may change an `APPROVED` line's quantity, and nothing else.**
   *   That single field is what a person in the aisle learns that the list did
   *   not know. Content, item reference and position are untouched, and a request
   *   from such a caller naming any other field is refused rather than silently
   *   trimmed, because a client that thought it was renaming a line must find out
   *   that it did not.
   *
   * Holding `WRITE` **and** `DECIDE` does not add up to editing an approved
   * line's content: the path for that is un-approve, edit, approve, which is
   * three taps and leaves the line's approval state saying what happened. The
   * `MANAGE` bypass is the shortcut for the person who governs the list, not the
   * only way through.
   *
   * ## Editing a rejected line puts it back to `PENDING` (0036, section 4.2)
   *
   * ...and clears its approver, which is what makes a rejection a conversation
   * rather than a dead end. On **any** edit, including a quantity-only one, and
   * including on a list that auto approves: that option decides what a **new**
   * line starts as, and a rejection somebody made on purpose is not undone by an
   * edit. A `PENDING` line stays `PENDING`.
   *
   * ## Lowering an approved quantity leaves the remainder behind (0037, section 4)
   *
   * See {@link splitRemainder}. The invariant is that the quantity a list asked
   * for is not lost when a shopper comes back with less.
   */
  async update(req: UpdateLineRequest): Promise<LineView> {
    const line = await this.listAccess.getLine(req.lineId);
    const { list, permissions } = await this.listAccess.resolve(
      line.listId,
      req.userId
    );
    this.authorizeEdit(req, line, permissions);

    if (req.content !== undefined) {
      line.content = req.content;
    }
    const previousQuantity = line.quantity;
    if (req.quantity !== undefined) {
      line.quantity = this.validateQuantity(req.quantity);
    }
    if (req.itemId !== undefined) {
      line.itemId = this.validateItemId(req.itemId);
    }
    if (line.approvalStatus === LineApprovalStatus.REJECTED) {
      line.approvalStatus = LineApprovalStatus.PENDING;
      line.approvedByUserId = null;
    }
    line.version += 1;

    const shortfall =
      line.approvalStatus === LineApprovalStatus.APPROVED &&
      !list.autoApproveLines
        ? previousQuantity - line.quantity
        : 0;

    if (shortfall <= 0) {
      const saved = await this.lines.save(line);
      this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
      return toLineView(saved);
    }
    return this.splitRemainder(line, shortfall, list);
  }

  /**
   * Which of the three answers above applies to this request (0036, section 4.1).
   *
   * Written as one method rather than inline so the branch reads in the order the
   * plan states it, and so the refusal for "you may change the quantity and you
   * tried to change the content" is distinguishable from "you may not touch this
   * line at all". `READ` reaches neither and falls out of the last branch, which
   * is worth saying twice because "can see everything" is easy to read as "can
   * correct a small thing".
   */
  private authorizeEdit(
    req: UpdateLineRequest,
    line: ListLine,
    permissions: ReadonlySet<ListPermission>
  ): void {
    if (permissions.has(ListPermission.MANAGE)) {
      return;
    }
    if (line.approvalStatus === LineApprovalStatus.APPROVED) {
      if (!permissions.has(ListPermission.DECIDE)) {
        throw new ForbiddenException(
          'This line has been approved, so only its quantity can be changed and only by somebody who can approve lines'
        );
      }
      if (req.content !== undefined || req.itemId !== undefined) {
        throw new ForbiddenException(
          'Only the quantity of an approved line can be changed. Set it back to pending first to change anything else'
        );
      }
      return;
    }
    if (!permissions.has(ListPermission.WRITE)) {
      throw new ForbiddenException('You need write access to this list');
    }
  }

  /**
   * Reducing an approved line's quantity writes two rows (plan 0037, section 4).
   *
   * Somebody in the aisle finds one tin where the list says three. Setting the
   * quantity to 1 on its own silently rewrites history: the list would then say
   * somebody asked for one tin, and the two they did not get would have vanished
   * with no record that they were ever wanted. So the original keeps the new lower
   * quantity and a second line records the shortfall, `APPROVED` and
   * `NOT_AVAILABLE`, in one transaction so neither can exist without the other.
   *
   * **The server and not the client**, because the caller who performs this edit
   * holds `DECIDE` and, in the ordinary case, nothing else, and `DECIDE` cannot
   * create a line. A client physically cannot produce the second row, and a
   * permission model that needed it to would have to grant every shopper `WRITE`
   * to make one feature work.
   *
   * **The rule is about the line, not about who edited it** (section 4.2). Any
   * reduction on an approved line splits, including one made by a list admin or a
   * group admin. The one case that costs us is somebody correcting a typo, who
   * gets a "2 not available" line nobody ever wanted; that is accepted, because
   * the line really was approved at 3 and the split is the honest record of
   * undoing it, and because a rule keyed on the actor produces different data for
   * the same edit depending on who is signed in, which is not explainable in any
   * user interface.
   *
   * A list with `autoApproveLines` set never gets here, which is checked by the
   * caller: such a list has decided that approval carries no information on it,
   * so there is nothing for a remainder to preserve and the split would leave a
   * trail of unavailable rows on precisely the lists whose owners chose the
   * setting to reduce ceremony (section 4.5).
   *
   * `createdByUserId` is copied from the **original line's author**, not taken
   * from the shopper: the remainder is the unfilled part of that person's request,
   * and attributing it to the shopper would put a line nobody asked for under the
   * shopper's name. `approvedByUserId` is copied for the same reason, since it
   * carries the approval the original already had. `content` and `itemId` come
   * from the original as it now stands, which differs from how it stood only for a
   * `MANAGE` holder editing both at once, and the request as it now reads is the
   * one the remainder is left over from.
   */
  private async splitRemainder(
    line: ListLine,
    shortfall: number,
    list: ShoppingList
  ): Promise<LineView> {
    const position = await this.positionBelow(line);

    const { saved, remainder } = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const repo = manager.getRepository(ListLine);
        const saved = await repo.save(line);
        const remainder = await repo.save(
          repo.create({
            listId: line.listId,
            content: line.content,
            quantity: shortfall,
            itemId: line.itemId,
            position,
            approvalStatus: LineApprovalStatus.APPROVED,
            status: LineStatus.NOT_AVAILABLE,
            createdByUserId: line.createdByUserId,
            approvedByUserId: line.approvedByUserId,
            version: 1,
          })
        );
        return { saved, remainder };
      }
    );

    // The order is load bearing (plan 0037, section 5). A client rendering
    // optimistically that saw the add first would draw a list momentarily summing
    // to more than was ever asked for; updating first means every frame it can
    // paint is arithmetically true. Both are existing event types going to the
    // existing list room, so a client that knows nothing about this plan still
    // gets a correct list.
    this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
    this.emit(RealtimeEvent.LineAdded, list.zoneId, remainder);
    return toLineView(saved);
  }

  /**
   * Where the remainder goes: immediately below the line it came from (0037, 4.3).
   *
   * `position` is `double precision` for exactly this. The midpoint between the
   * original and the next line down, or one past the original when it is last, so
   * **no other row is renumbered**: nothing else in the list moves and a
   * concurrent reorder is not invalidated. Appending to the end instead would put
   * the shortfall a screen away from the request it belongs to, which is the part
   * a naive implementation gets wrong.
   */
  private async positionBelow(line: ListLine): Promise<number> {
    const next = await this.lines
      .createQueryBuilder('l')
      .select('MIN(l.position)', 'next')
      .where('l."listId" = :listId', { listId: line.listId })
      .andWhere('l.position > :position', { position: line.position })
      .getRawOne<{ next: number | null }>();

    const below = next?.next;
    return below === null || below === undefined
      ? line.position + 1
      : (line.position + Number(below)) / 2;
  }

  /**
   * Approve, reject or un-approve a line (plan 0007, section 2). `DECIDE`.
   *
   * It used to ask for a zone `OWNER` or `ADMIN`, which made approval a property
   * of the **group** rather than of the list and therefore impossible to delegate
   * (plan 0036, section 1.2). The person who actually walks the aisle is exactly
   * the person who should be allowed to say "yes, that one goes in", and they
   * could previously only be allowed to by being made an admin of the whole
   * group. Group staff still reach it, because they hold `DECIDE` on every list
   * in their zone by derivation.
   */
  async setApproval(req: SetLineApprovalRequest): Promise<LineView> {
    const line = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.requireDecide(line.listId, req.userId);
    line.approvalStatus = req.approvalStatus;
    line.approvedByUserId =
      req.approvalStatus === LineApprovalStatus.PENDING ? null : req.userId;
    line.version += 1;
    const saved = await this.lines.save(line);
    this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
    return toLineView(saved);
  }

  /**
   * Move a line between item states (plan 0007, section 2). `DECIDE`.
   *
   * Ticking off and writing were the same permission, and should not have been
   * (plan 0036, section 1.3): there was no way to describe the flatmate who does
   * the shop but does not decide what goes on the list, which is the commonest
   * arrangement this product has.
   */
  async setStatus(req: SetLineStatusRequest): Promise<LineView> {
    const line = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.requireDecide(line.listId, req.userId);
    line.status = req.status;
    line.version += 1;
    const saved = await this.lines.save(line);
    this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
    return toLineView(saved);
  }

  /**
   * Reorder the lines of a list (plan 0007, section 2). `WRITE`. Rewrites each
   * line's position to its index in `orderedLineIds` and bumps its version.
   */
  async reorder(req: ReorderLinesRequest): Promise<{ listId: string }> {
    const list = await this.listAccess.requireWrite(req.listId, req.userId);
    const lines = await this.lines.find({ where: { listId: req.listId } });
    const byId = new Map(lines.map((l) => [l.id, l]));
    if (req.orderedLineIds.some((id) => !byId.has(id))) {
      throw new ValidationException('The order references an unknown line');
    }

    await this.dataSource.transaction(async (manager) => {
      let position = 1;
      for (const id of req.orderedLineIds) {
        const line = byId.get(id);
        if (line) {
          line.position = position++;
          line.version += 1;
          await manager.getRepository(ListLine).save(line);
        }
      }
    });

    this.events.emit(
      RealtimeEvent.LineReordered,
      list.zoneId,
      {
        listId: req.listId,
        orderedLineIds: req.orderedLineIds,
      },
      req.listId
    );
    return { listId: req.listId };
  }

  /**
   * Delete a line (plan 0007, section 2; plan 0036, section 4.1).
   *
   * `WRITE` on a `PENDING` or `REJECTED` line, `MANAGE` on any line. The same
   * asymmetry as {@link update} and for the same reason: a writer whose line has
   * been agreed to cannot quietly remove what was agreed to, and a list admin has
   * to be able to remove an approved line that should never have existed, which
   * includes a remainder somebody minds (plan 0037, section 4.2).
   */
  async delete(req: DeleteLineRequest): Promise<{ id: string }> {
    const line = await this.listAccess.getLine(req.lineId);
    const { list, permissions } = await this.listAccess.resolve(
      line.listId,
      req.userId
    );
    if (!permissions.has(ListPermission.MANAGE)) {
      if (line.approvalStatus === LineApprovalStatus.APPROVED) {
        throw new ForbiddenException(
          'This line has been approved, so only an admin of this list can delete it'
        );
      }
      if (!permissions.has(ListPermission.WRITE)) {
        throw new ForbiddenException('You need write access to this list');
      }
    }
    await this.lines.delete({ id: line.id });
    this.events.emit(
      RealtimeEvent.LineDeleted,
      list.zoneId,
      {
        id: line.id,
        listId: line.listId,
      },
      line.listId
    );
    return { id: line.id };
  }

  /**
   * List a list's lines (plan 0007, section 3). `READ`. Cursor paginated and
   * orderable; default order is the manual `position`.
   */
  async list(req: ListLinesRequest): Promise<LinePage> {
    await this.listAccess.requireRead(req.listId, req.userId);
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LineCursor | undefined;

    const qb = this.lines
      .createQueryBuilder('l')
      .where('l."listId" = :listId', { listId: req.listId })
      .take(limit + 1);

    this.applyOrder(qb, order, cursor);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(toLineView);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            order,
            value: this.cursorValue(order, last),
            id: last.id,
          })
        : null;

    return { items, nextCursor };
  }

  private resolveOrder(order?: string): LineOrder {
    return order === 'created' || order === 'updated' ? order : 'position';
  }

  private applyOrder(
    qb: SelectQueryBuilder<ListLine>,
    order: LineOrder,
    cursor?: LineCursor
  ): void {
    if (order === 'created') {
      qb.orderBy('l.createdAt', 'DESC').addOrderBy('l.id', 'DESC');
      if (cursor) {
        qb.andWhere('(l."createdAt", l.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'updated') {
      qb.orderBy('l.updatedAt', 'DESC').addOrderBy('l.id', 'DESC');
      if (cursor) {
        qb.andWhere('(l."updatedAt", l.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      qb.orderBy('l.position', 'ASC').addOrderBy('l.id', 'ASC');
      if (cursor) {
        qb.andWhere('(l.position, l.id) > (:cv, :cid)', {
          cv: Number(cursor.value),
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: LineOrder, line: ListLine): string {
    if (order === 'created') {
      return line.createdAt.toISOString();
    }
    if (order === 'updated') {
      return line.updatedAt.toISOString();
    }
    return String(line.position);
  }
}
