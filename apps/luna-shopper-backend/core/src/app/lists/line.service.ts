import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LINE_BATCH_MAX_ITEMS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  RealtimeEvent,
  type AddLineQuantityRequest,
  type AddLineRequest,
  type AddLinesItem,
  type AddLinesRequest,
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
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  DataSource,
  Repository,
  type DeepPartial,
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

/**
 * A write that has happened but has not been announced.
 *
 * Every path that writes a line inside a transaction hands one of these back so
 * the enclosing method can emit **after the commit**, as everywhere else in this
 * service. The order of `events` is load bearing wherever there is more than one
 * (plan 0037, section 5), so it is a list rather than a set of flags.
 */
interface WrittenLines {
  view: LineView;
  events: { event: RealtimeEvent; line: ListLine }[];
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
    const max = await this.maxPosition(this.lines, req.listId);

    const saved = await this.lines.save(
      this.lines.create(
        this.newLine(req, req.listId, req.userId, max + 1, {
          decides: permissions.has(ListPermission.DECIDE),
          autoApproves: list.autoApproveLines,
        })
      )
    );
    this.emit(RealtimeEvent.LineAdded, list.zoneId, saved);
    return toLineView(saved);
  }

  /**
   * Add up to {@link LINE_BATCH_MAX_ITEMS} lines in one transaction (plan 0040,
   * section 6). `WRITE`.
   *
   * ## All or nothing, and not a per item result array
   *
   * The instinct is to report per item, so that nine good items are not refused
   * because of one bad one. Worked through, it guards against something that
   * cannot happen: access is a property of the list and the caller, the approval
   * rules are a property of their permissions and the list's `autoApproveLines`,
   * and the per item bounds have already produced a 400 for the whole request at
   * the gateway. What is left is a database failure, which is not per item
   * either. So one transaction, and `LineView[]` in request order, which is the
   * shape `reorder` already established for a batch write on this resource.
   *
   * **It adds, and it does not merge** (section 6.3). Two items naming the same
   * thing produce two lines: merging would put "asking for milk twice should
   * change a number" into core, where it does not belong, and where it would then
   * apply to somebody pasting a list who may well have meant two entries.
   *
   * **The permission set is resolved once** and applies to every item, which is
   * right because it is one adder and one list, and it is most of the point:
   * fifty adds is otherwise fifty resolutions of one unchanging answer.
   */
  async addMany(req: AddLinesRequest): Promise<LineView[]> {
    const items = req.items ?? [];
    if (items.length === 0) {
      throw new ValidationException('at least one line is required', {
        messageArgs: { field: 'items' },
      });
    }
    if (items.length > LINE_BATCH_MAX_ITEMS) {
      throw new ValidationException(
        `at most ${LINE_BATCH_MAX_ITEMS} lines can be added at once`,
        { messageArgs: { field: 'items' } }
      );
    }

    const { list, permissions } = await this.listAccess.requireAccess(
      req.listId,
      req.userId,
      ListPermission.WRITE
    );
    const approval = {
      decides: permissions.has(ListPermission.DECIDE),
      autoApproves: list.autoApproveLines,
    };

    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ListLine);
      // One MAX(position) for the whole batch, then an increment per item, so the
      // lines land in the order they were given (section 6.2).
      let position = await this.maxPosition(repo, req.listId);
      const rows: ListLine[] = [];
      for (const item of items) {
        position += 1;
        rows.push(
          await repo.save(
            repo.create(
              this.newLine(item, req.listId, req.userId, position, approval)
            )
          )
        );
      }
      return rows;
    });

    // N `LineAdded` events in request order, after the commit, and deliberately
    // not one batch event: a new event type is a type every client has to learn,
    // and velista, the realtime service and the list rooms all already handle
    // `line.added` correctly, so a client that has never heard of this plan gets
    // a correct list. The burst is exactly the fan out the N separate requests it
    // replaces would have produced anyway.
    for (const row of saved) {
      this.emit(RealtimeEvent.LineAdded, list.zoneId, row);
    }
    return saved.map(toLineView);
  }

  /**
   * The row a new line starts as, with plan 0037 section 2's three approval rules
   * applied to it.
   *
   * Shared by {@link add} and {@link addMany} so a batch cannot answer the
   * approval question differently from a single add. The two flags are resolved
   * once per request by the caller, because they are properties of the adder and
   * of the list rather than of the item.
   */
  private newLine(
    item: AddLinesItem,
    listId: string,
    userId: string,
    position: number,
    approval: { decides: boolean; autoApproves: boolean }
  ): DeepPartial<ListLine> {
    return {
      listId,
      content: item.content,
      quantity: this.validateQuantity(item.quantity ?? 1),
      itemId: this.validateItemId(item.itemId ?? null),
      position,
      approvalStatus:
        approval.decides || approval.autoApproves
          ? LineApprovalStatus.APPROVED
          : LineApprovalStatus.PENDING,
      status: LineStatus.PENDING,
      createdByUserId: userId,
      approvedByUserId: approval.decides ? userId : null,
      version: 1,
    };
  }

  /** The highest position on a list, or zero when it holds no lines. */
  private async maxPosition(
    repo: Repository<ListLine>,
    listId: string
  ): Promise<number> {
    const max = await repo
      .createQueryBuilder('l')
      .select('COALESCE(MAX(l.position), 0)', 'max')
      .where('l."listId" = :listId', { listId })
      .getRawOne<{ max: number }>();
    return Number(max?.max ?? 0);
  }

  /**
   * A quantity between one and {@link LINE_QUANTITY_MAX} (plan 0037, section 4.4;
   * plan 0040, section 3.5).
   *
   * The gateway DTO says both bounds, and core says them again rather than
   * trusting the caller: core's callers are NATS messages, the gateway is one of
   * them rather than a wall, and a bound that only one of two layers enforces is
   * a bound that a second client, a replayed message or a future service can walk
   * straight through. "None of it was there" is `NOT_AVAILABLE` on the whole
   * line, which is a control the same caller already has.
   *
   * The **ceiling** arrived with the delta and is the reason this comment now
   * says "bound" where it used to say "floor". It was survivable at one layer
   * while every write carried an absolute value the gateway had already checked;
   * {@link addQuantity} computes its value here, so here is the only place that
   * can check the result. The numbers themselves come from the contract, so the
   * DTOs and this method cannot state different ones.
   */
  private validateQuantity(quantity: number): number {
    if (!Number.isInteger(quantity) || quantity < LINE_QUANTITY_MIN) {
      throw new ValidationException(
        `quantity must be at least ${LINE_QUANTITY_MIN}`,
        { messageArgs: { field: 'quantity' } }
      );
    }
    if (quantity > LINE_QUANTITY_MAX) {
      throw new ValidationException(
        `quantity must be at most ${LINE_QUANTITY_MAX}`,
        { messageArgs: { field: 'quantity' } }
      );
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
    this.reopenIfRejected(line);
    line.version += 1;

    const shortfall = this.shortfall(line, previousQuantity, list);
    if (shortfall <= 0) {
      // No second row, so no transaction. That is correct here and stays correct
      // now that a delta exists beside it (plan 0040, section 3.4): an absolute
      // write is a last-writer-wins race over a value somebody deliberately
      // chose, and there is nothing to lock it against.
      const saved = await this.lines.save(line);
      this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
      return toLineView(saved);
    }

    return this.announce(
      list,
      await this.dataSource.transaction((manager) =>
        this.writeEdit(manager, line, shortfall)
      )
    );
  }

  /**
   * Add units to a line, or take them off, without reading it first (plan 0040,
   * section 3).
   *
   * ## It introduces no new permission, no new transition and no new event
   *
   * That is the claim the whole thing rests on. The delta is **arithmetic in
   * front of the edit that already exists**: it reaches the same
   * {@link authorizeEdit}, the same rejected-to-pending reset, the same
   * {@link splitRemainder}, and it emits the same events. So an approved line's
   * quantity still moves only for a caller holding `DECIDE`, adding to a rejected
   * line still returns it to `PENDING` and clears its approver, and a negative
   * delta on an approved line still leaves the remainder behind. Adding units is
   * an edit, and this does not get to be a softer edit.
   *
   * ## The read is inside the write
   *
   * `update` needs no lock because the value it writes is one the caller chose. A
   * delta is computed from what the row says, so a concurrent write between the
   * read and the write is an update that vanishes with nothing logged and nothing
   * errored, which is what the API forced on every caller that wanted "two more"
   * and had to fetch, compute and `PATCH` to get it (section 2).
   *
   * ## A negative delta is allowed
   *
   * Refusing one would leave "one less" as the single thing a caller still has to
   * do with a read and a write, which is precisely the failure this exists to
   * remove. Routing it through the same code costs nothing, because that code
   * already knows what a reduction means.
   */
  async addQuantity(req: AddLineQuantityRequest): Promise<LineView> {
    this.validateDelta(req.delta);

    // Resolved **before** the transaction, and not because it is cheaper there.
    // Every repository the access service holds draws its own connection from the
    // pool, so asking it a question from inside a transaction means one request
    // holding two connections at once; enough concurrent deltas and every
    // connection in the pool is a transaction waiting for a connection that will
    // never come free. What is resolved out here is a property of the caller and
    // the list rather than of the row, so reading it outside the lock changes no
    // answer. The row state the authorization actually branches on, its approval,
    // is read under the lock below.
    const found = await this.listAccess.getLine(req.lineId);
    const { list, permissions } = await this.listAccess.resolve(
      found.listId,
      req.userId
    );

    const written = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ListLine);
      const line = await repo.findOne({
        where: { id: req.lineId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!line) {
        throw new NotFoundException('Line not found');
      }

      const previousQuantity = line.quantity;
      const quantity = this.validateQuantity(previousQuantity + req.delta);
      // The request an absolute edit of the same field would have been, so the
      // refusal a caller gets is word for word the one the PATCH gives them.
      this.authorizeEdit(
        { userId: req.userId, lineId: req.lineId, quantity },
        line,
        permissions
      );

      line.quantity = quantity;
      this.reopenIfRejected(line);
      line.version += 1;

      return this.writeEdit(
        manager,
        line,
        this.shortfall(line, previousQuantity, list)
      );
    });

    return this.announce(list, written);
  }

  /**
   * A non zero integer, bounded in both directions (plan 0040, section 3.3).
   *
   * Zero is refused because a delta of zero is a request that means nothing and
   * is more likely a client bug than an intention. The bound is the quantity
   * ceiling rather than a number of its own, so no single call can move a line
   * further than the largest quantity a line may hold; the **resulting** quantity
   * is what {@link validateQuantity} then applies the real floor and ceiling to.
   */
  private validateDelta(delta: number): number {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new ValidationException('delta must be a non zero whole number', {
        messageArgs: { field: 'delta' },
      });
    }
    if (Math.abs(delta) > LINE_QUANTITY_MAX) {
      throw new ValidationException(
        `delta must be between -${LINE_QUANTITY_MAX} and ${LINE_QUANTITY_MAX}`,
        { messageArgs: { field: 'delta' } }
      );
    }
    return delta;
  }

  /**
   * Editing a rejected line puts it back to `PENDING` (plan 0036, section 4.2).
   *
   * ...and clears its approver, which is what makes a rejection a conversation
   * rather than a dead end. On **any** edit, including a quantity-only one, a
   * delta, and one on a list that auto approves: that option decides what a
   * **new** line starts as, and a rejection somebody made on purpose is not
   * undone by an edit. A `PENDING` line stays `PENDING`.
   */
  private reopenIfRejected(line: ListLine): void {
    if (line.approvalStatus === LineApprovalStatus.REJECTED) {
      line.approvalStatus = LineApprovalStatus.PENDING;
      line.approvedByUserId = null;
    }
  }

  /**
   * How much of an approved request this edit just dropped, or zero.
   *
   * A list with `autoApproveLines` set always answers zero (plan 0037, section
   * 4.5): it has decided that approval carries no information on it, so there is
   * nothing for a remainder to preserve, and splitting would leave a trail of
   * unavailable rows on precisely the lists whose owners chose the setting to
   * reduce ceremony.
   */
  private shortfall(
    line: ListLine,
    previousQuantity: number,
    list: ShoppingList
  ): number {
    return line.approvalStatus === LineApprovalStatus.APPROVED &&
      !list.autoApproveLines
      ? previousQuantity - line.quantity
      : 0;
  }

  /**
   * The write half of an edit, in whatever transaction its caller opened.
   *
   * It never opens one of its own, because the two callers need different ones:
   * {@link update} opens one only when a split makes two rows depend on each
   * other, and {@link addQuantity} is already inside one because a delta has to
   * read under the lock it writes with. Events are returned rather than emitted,
   * so the caller announces them after its commit, as everywhere else here.
   */
  private async writeEdit(
    manager: EntityManager,
    line: ListLine,
    shortfall: number
  ): Promise<WrittenLines> {
    const repo = manager.getRepository(ListLine);
    if (shortfall <= 0) {
      const saved = await repo.save(line);
      return {
        view: toLineView(saved),
        events: [{ event: RealtimeEvent.LineUpdated, line: saved }],
      };
    }
    return this.splitRemainder(repo, line, shortfall);
  }

  /**
   * Emits what a committed write produced, and answers with its view.
   *
   * The order of the events is load bearing (plan 0037, section 5). A client
   * rendering optimistically that saw the add first would draw a list momentarily
   * summing to more than was ever asked for; updating first means every frame it
   * can paint is arithmetically true. Both are existing event types going to the
   * existing list room, so a client that knows nothing about either plan still
   * gets a correct list.
   */
  private announce(list: ShoppingList, written: WrittenLines): LineView {
    for (const { event, line } of written.events) {
      this.emit(event, list.zoneId, line);
    }
    return written.view;
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
   * `NOT_AVAILABLE`, in the caller's transaction so neither can exist without the
   * other. The transaction belongs to the caller because {@link addQuantity} is
   * already inside one when it gets here (plan 0040, section 3.4) and a second,
   * nested one would be a lock released halfway through the thing it was taken
   * for.
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
    repo: Repository<ListLine>,
    line: ListLine,
    shortfall: number
  ): Promise<WrittenLines> {
    const position = await this.positionBelow(repo, line);

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

    return {
      view: toLineView(saved),
      events: [
        { event: RealtimeEvent.LineUpdated, line: saved },
        { event: RealtimeEvent.LineAdded, line: remainder },
      ],
    };
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
  private async positionBelow(
    repo: Repository<ListLine>,
    line: ListLine
  ): Promise<number> {
    const next = await repo
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
