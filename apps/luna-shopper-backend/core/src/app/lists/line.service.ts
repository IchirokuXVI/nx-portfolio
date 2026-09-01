import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LINE_BATCH_MAX_ITEMS,
  LINE_ITEM_SET_MAX,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LineApprovalStatus,
  ListPermission,
  NO_LINE_CLAIM,
  NO_LINE_SETTLEMENTS,
  RealtimeEvent,
  SettlementOutcome,
  type AddLineQuantityRequest,
  type AddLineRequest,
  type AddLinesItem,
  type AddLinesRequest,
  type DeleteLineRequest,
  type LineClaim,
  type LineOrder,
  type LinePage,
  type LineSettlementSummary,
  type LineView,
  type ListLinesRequest,
  type ReorderLinesRequest,
  type SetLineApprovalRequest,
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
  In,
  Repository,
  type DeepPartial,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';
import {
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineClaimService } from '../generated-lists/line-claim.service';
import { itemSetHash } from './item-set-hash';
import { ListAccessService } from './list-access.service';
import { toLineView } from './list.mappers';
import { readLineSettlementSummaries } from './settlement.sql';

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
 * service.
 *
 * It used to carry a **list** of events in a load bearing order, because plan
 * 0037 had a reduction write two rows. Plan 0047 retired that (see
 * {@link update}), so an edit is one row and one event again.
 */
interface WrittenLine {
  view: LineView;
  line: ListLine;
  itemIds: string[];
  /** Carried so the announcement says what a read would, not the zero summary. */
  settlements: LineSettlementSummary;
  /** And the third indicator, for the same reason (plan 0052, section 4). */
  claim: LineClaim;
}

/** Canonical UUID shape, for validating the cross-service catalog `itemId`. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class LineService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ListLine) private readonly lines: Repository<ListLine>,
    @InjectRepository(ListLineItem)
    private readonly lineItems: Repository<ListLineItem>,
    // Read only, and never written here: what a shopper found is
    // `SettlementService`'s to record. This service reads it because every line
    // it answers with carries the two indicators derived from it (plan 0047,
    // section 5), and a line read that left them out would make a settled line
    // indistinguishable from one nobody has ever wanted.
    @InjectRepository(LineSettlement)
    private readonly settlements: Repository<LineSettlement>,
    private readonly listAccess: ListAccessService,
    // Read only as well, and for the same shape of reason as the settlements
    // above: every line this service answers with carries the third indicator
    // (plan 0052, section 4), and a read that left it out would take the "Ana is
    // buying this" mark off a line the moment anybody edited it.
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Validate a line's product set (plan 0012, section 4; plan 0048, section 1.1).
   *
   * Each reference is cross service, so only its **shape** is checked here (a
   * UUID); whether the catalog holds it is the client's concern and core never
   * joins to the catalog database. That was true of the single `itemId` this
   * replaced and nothing about a set changes it.
   *
   * Duplicates are dropped rather than refused, keeping the first occurrence.
   * Naming a product twice is not a request that means anything different from
   * naming it once, and the hash would flatten it anyway, so a refusal would only
   * teach a client to de-duplicate before asking.
   */
  private validateItemIds(itemIds: readonly string[]): string[] {
    if (itemIds.length > LINE_ITEM_SET_MAX) {
      throw new ValidationException(
        `a line can hold at most ${LINE_ITEM_SET_MAX} products`,
        { messageArgs: { field: 'itemIds' } }
      );
    }
    for (const itemId of itemIds) {
      if (typeof itemId !== 'string' || !UUID_PATTERN.test(itemId)) {
        throw new ValidationException(
          'itemIds must all be valid item references',
          { messageArgs: { field: 'itemIds' } }
        );
      }
    }
    return [...new Set(itemIds)];
  }

  /** A line's products, in the order they were attached. */
  private async itemIdsOf(
    lineId: string,
    manager?: EntityManager
  ): Promise<string[]> {
    const repo = manager ? manager.getRepository(ListLineItem) : this.lineItems;
    const rows = await repo.find({
      where: { lineId },
      order: { position: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => row.itemId);
  }

  /** The same, for a page of lines, in one query rather than one per line. */
  private async itemIdsOfMany(
    lineIds: string[]
  ): Promise<Map<string, string[]>> {
    const sets = new Map<string, string[]>(lineIds.map((id) => [id, []]));
    if (lineIds.length === 0) {
      return sets;
    }
    const rows = await this.lineItems.find({
      where: { lineId: In(lineIds) },
      order: { position: 'ASC', id: 'ASC' },
    });
    for (const row of rows) {
      sets.get(row.lineId)?.push(row.itemId);
    }
    return sets;
  }

  /**
   * The two derived indicators for a whole page of lines, in one query (plan
   * 0047, section 5).
   *
   * One aggregate over `ix_settlements_line` rather than a read per row, which is
   * the same rule {@link itemIdsOfMany} follows: the list page asks this question
   * about every line it draws, so answering it one line at a time would be a
   * request per row of a screen somebody opens in a shop.
   *
   * Raw SQL, because both halves are things a query builder states badly. The
   * count is a `FILTER` over one outcome, and the most recent outcome is the
   * first element of an ordered aggregate, which is how it is read without a
   * correlated subquery per line or a window over the whole table.
   *
   * A line with no settlements has **no row here at all**, and the map's default
   * is what makes that the honest answer rather than an absent one: never bought,
   * nothing to report.
   */
  private async settlementsOfMany(
    lineIds: string[]
  ): Promise<Map<string, LineSettlementSummary>> {
    return readLineSettlementSummaries(
      (sql, parameters) => this.dataSource.query(sql, parameters),
      lineIds
    );
  }

  /**
   * One line's summary, for the paths that answer with a single line.
   *
   * Two repository reads rather than the aggregate above, and the difference is
   * deliberate. The aggregate exists because a page asks the question about
   * twenty lines at once; for one line it is two index lookups on
   * `ix_settlements_line`, which is cheaper to read here and needs no raw SQL on
   * a path that is already an edit rather than a report.
   *
   * **A caller inside a transaction must pass its manager**, and this is the trap
   * {@link addQuantity} already documents at length: this service's own repository
   * draws its own connection from the pool, so reading through it from inside a
   * transaction means one request holding two connections at once. Ten concurrent
   * deltas is then ten transactions each waiting on a connection that will never
   * come free, which is a deadlock that only shows up under load and which the
   * integration suite caught rather than any unit test.
   *
   * Reading through the caller's manager is not a compromise either. This service
   * never writes `line_settlements`, so the transaction has nothing uncommitted
   * there and both routes see exactly the same rows.
   */
  private async settlementsOf(
    lineId: string,
    manager?: EntityManager
  ): Promise<LineSettlementSummary> {
    const repo = manager
      ? manager.getRepository(LineSettlement)
      : this.settlements;

    // Sequential rather than `Promise.all`, for the same reason. One manager is one
    // connection, so two queries issued at once on it are serialised by the driver
    // anyway; on the pooled path the pair is two connections briefly held, which is
    // exactly what the paragraph above is about.
    const boughtCount = await repo.count({
      where: { lineId, outcome: SettlementOutcome.BOUGHT },
    });
    const latest = await repo.findOne({
      where: { lineId },
      order: { settledAt: 'DESC', id: 'DESC' },
    });

    return { boughtCount, lastOutcome: latest?.outcome ?? null };
  }

  /**
   * Replace a line's product set (plan 0048, section 1.1).
   *
   * Delete then insert, rather than a diff, because the request states a whole
   * set and the join rows carry nothing worth preserving across a replacement:
   * the only column that is not the pair itself is the insertion order, which the
   * new set restates. Always inside the caller's transaction, so a line's stored
   * hash can never disagree with the rows it summarises.
   */
  private async writeItemSet(
    manager: EntityManager,
    lineId: string,
    itemIds: readonly string[]
  ): Promise<void> {
    const repo = manager.getRepository(ListLineItem);
    await repo.delete({ lineId });
    if (itemIds.length > 0) {
      await repo.insert(
        itemIds.map((itemId, position) => ({ lineId, itemId, position }))
      );
    }
  }

  /**
   * Announce a line, exactly as a read of it would answer.
   *
   * The settlement summary is a parameter with no default here, unlike on the
   * mapper, and that is deliberate: every event carries a **whole** line, and a
   * client reconciles the fields it is not itself writing straight off it. An
   * edit that announced the zero summary would take the bought indicator off a
   * settled line on every other phone in the household, for no reason other than
   * somebody having renamed it. A line that has just been created is the one case
   * where zero is the truth, and it says so at the call site.
   *
   * The claim is carried on exactly the same terms (plan 0052, section 4): it is
   * a whole line on the wire, so an edit that announced an unclaimed one would
   * clear the indicator on every phone in the household over a rename.
   */
  private emit(
    event: RealtimeEvent,
    zoneId: string,
    line: ListLine,
    itemIds: string[],
    settlements: LineSettlementSummary,
    claim: LineClaim
  ): void {
    this.events.emit(
      event,
      zoneId,
      toLineView(line, itemIds, settlements, claim),
      line.listId
    );
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
   * None of the three says anything about whether the thing has been bought.
   * That was a second state machine on the line until plan 0047 dropped it, and
   * it is a settlement now: whether the group agreed to buy a thing and whether
   * somebody has been to the shop are different questions, and auto approving the
   * first answers nothing about the second.
   */
  async add(req: AddLineRequest): Promise<LineView> {
    const { list, permissions } = await this.listAccess.requireAccess(
      req.listId,
      req.userId,
      ListPermission.WRITE
    );
    const max = await this.maxPosition(this.lines, req.listId);
    const itemIds = this.validateItemIds(req.itemIds ?? []);
    const approval = {
      decides: permissions.has(ListPermission.DECIDE),
      autoApproves: list.autoApproveLines,
    };
    const row = this.newLine(req, req.listId, req.userId, max + 1, approval);

    // A free text line is still one insert and no transaction, which matters
    // because it is the busiest write in the product and it is what most adds
    // still are (velista 0043, section 6: free text stays first class). A line
    // that arrives with products needs the row and its set to land together, so
    // that path, and only that path, opens a transaction.
    const saved =
      itemIds.length === 0
        ? await this.lines.save(this.lines.create(row))
        : await this.dataSource.transaction(async (manager) => {
            const repo = manager.getRepository(ListLine);
            const line = await repo.save(repo.create(row));
            await this.writeItemSet(manager, line.id, itemIds);
            return line;
          });

    // A line cannot have been bought in the same breath as being added, nor be
    // in somebody's basket a moment after it was typed, so the empty pair is the
    // truth here rather than a stand in for two unread values.
    this.emit(
      RealtimeEvent.LineAdded,
      list.zoneId,
      saved,
      itemIds,
      NO_LINE_SETTLEMENTS,
      NO_LINE_CLAIM
    );
    return toLineView(saved, itemIds, NO_LINE_SETTLEMENTS, NO_LINE_CLAIM);
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

    // Validated before the transaction opens, so a bad reference in the tenth
    // item refuses the request rather than rolling back nine good writes.
    const itemSets = items.map((item) =>
      this.validateItemIds(item.itemIds ?? [])
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ListLine);
      // One MAX(position) for the whole batch, then an increment per item, so the
      // lines land in the order they were given (section 6.2).
      let position = await this.maxPosition(repo, req.listId);
      const rows: ListLine[] = [];
      for (const [index, item] of items.entries()) {
        position += 1;
        const line = await repo.save(
          repo.create(
            this.newLine(item, req.listId, req.userId, position, approval)
          )
        );
        await this.writeItemSet(manager, line.id, itemSets[index]);
        rows.push(line);
      }
      return rows;
    });

    // N `LineAdded` events in request order, after the commit, and deliberately
    // not one batch event: a new event type is a type every client has to learn,
    // and velista, the realtime service and the list rooms all already handle
    // `line.added` correctly, so a client that has never heard of this plan gets
    // a correct list. The burst is exactly the fan out the N separate requests it
    // replaces would have produced anyway.
    for (const [index, row] of saved.entries()) {
      this.emit(
        RealtimeEvent.LineAdded,
        list.zoneId,
        row,
        itemSets[index],
        NO_LINE_SETTLEMENTS,
        NO_LINE_CLAIM
      );
    }
    return saved.map((row, index) =>
      toLineView(row, itemSets[index], NO_LINE_SETTLEMENTS, NO_LINE_CLAIM)
    );
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
      // The digest is a property of the set alone, so it can be stamped on the
      // row before the join rows exist (plan 0048, section 1.1).
      itemSetHash: itemSetHash(this.validateItemIds(item.itemIds ?? [])),
      position,
      approvalStatus:
        approval.decides || approval.autoApproves
          ? LineApprovalStatus.APPROVED
          : LineApprovalStatus.PENDING,
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
   * ## Lowering a quantity no longer leaves a remainder behind
   *
   * Plan 0037 made a reduction of an approved line write **two** rows: the line
   * at its new lower quantity, and a second `NOT_AVAILABLE` line holding the
   * shortfall, so that a shopper coming back with one tin of three did not
   * silently rewrite the list into having asked for one.
   *
   * That rule died with the trip status it was written in (plan 0047). A zone
   * line's quantity is now how many the household wants **right now**, and
   * lowering it is the primary gesture on the list page rather than a report from
   * a shop; the remainder row would be an ordinary approved line at the shortfall
   * quantity, which is to say a line the list would immediately count as wanted
   * again. What a shopper found is a `line_settlements` row now, written by
   * `SettlementService.settle`, which is the record plan 0037 was reaching for
   * and could not have without a table to put it in.
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
    if (req.quantity !== undefined) {
      line.quantity = this.validateQuantity(req.quantity);
    }
    // `undefined` leaves the set alone; `[]` clears it back to free text.
    const nextItemIds =
      req.itemIds === undefined ? undefined : this.validateItemIds(req.itemIds);
    if (nextItemIds !== undefined) {
      line.itemSetHash = itemSetHash(nextItemIds);
    }
    this.reopenIfRejected(line);
    line.version += 1;

    if (nextItemIds === undefined) {
      // No join rows, so no transaction. That is correct here and stays correct
      // now that a delta exists beside it (plan 0040, section 3.4): an absolute
      // write is a last-writer-wins race over a value somebody deliberately
      // chose, and there is nothing to lock it against.
      // No transaction on this path (see above), so the pooled repositories are
      // free to answer in parallel.
      const saved = await this.lines.save(line);
      const [itemIds, settlements, claim] = await Promise.all([
        this.itemIdsOf(saved.id),
        this.settlementsOf(saved.id),
        this.claims.claimOf(saved.id),
      ]);
      this.emit(
        RealtimeEvent.LineUpdated,
        list.zoneId,
        saved,
        itemIds,
        settlements,
        claim
      );
      return toLineView(saved, itemIds, settlements, claim);
    }

    // The set and the line have to move together, or a stored hash outlives the
    // rows it summarises.
    return this.announce(
      list,
      await this.dataSource.transaction((manager) =>
        this.writeEdit(manager, line, nextItemIds)
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
   * {@link authorizeEdit} and the same rejected-to-pending reset, and it emits
   * the same event. So an approved line's quantity still moves only for a caller
   * holding `DECIDE`, and adding to a rejected line still returns it to
   * `PENDING` and clears its approver. Adding units is an edit, and this does not
   * get to be a softer edit.
   *
   * It is also what velista's quantity reel writes, one delta per settled
   * adjustment (plan 0047, section 2.1). A control that follows a thumb emits a
   * run of changes, and absolute writes from a moving control race each other and
   * lose; a delta cannot.
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

      const quantity = this.validateQuantity(line.quantity + req.delta);
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

      return this.writeEdit(manager, line);
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
   * The write half of an edit, in whatever transaction its caller opened.
   *
   * It never opens one of its own, because the two callers need different ones:
   * {@link update} opens one only when it is also rewriting the product set, and
   * {@link addQuantity} is already inside one because a delta has to read under
   * the lock it writes with. The event is returned rather than emitted, so the
   * caller announces it after its commit, as everywhere else here.
   */
  private async writeEdit(
    manager: EntityManager,
    line: ListLine,
    nextItemIds?: string[]
  ): Promise<WrittenLine> {
    const repo = manager.getRepository(ListLine);
    if (nextItemIds !== undefined) {
      await this.writeItemSet(manager, line.id, nextItemIds);
    }
    // Whatever the line now holds: the set that was just written, or the one it
    // already had when this edit did not touch it.
    const itemIds = nextItemIds ?? (await this.itemIdsOf(line.id, manager));
    // **Through the caller's manager**, like the product set above it. Reading
    // through this service's own repository would take a second connection while
    // this transaction holds one, and `addQuantity` is exactly the concurrent path
    // where that deadlocks the pool. There is nothing to gain from the other route:
    // this service never writes settlements, so both see the same rows.
    const settlements = await this.settlementsOf(line.id, manager);
    // Through the caller's manager for the same reason, and with one of its own:
    // inside a settle's transaction the manager is the only route that can see
    // the basket line the settle has just moved (plan 0052, section 3.3).
    const claim = await this.claims.claimOf(line.id, manager);

    const saved = await repo.save(line);
    return {
      view: toLineView(saved, itemIds, settlements, claim),
      line: saved,
      itemIds,
      settlements,
      claim,
    };
  }

  /** Emits what a committed write produced, and answers with its view. */
  private announce(list: ShoppingList, written: WrittenLine): LineView {
    this.emit(
      RealtimeEvent.LineUpdated,
      list.zoneId,
      written.line,
      written.itemIds,
      written.settlements,
      written.claim
    );
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
      if (req.content !== undefined || req.itemIds !== undefined) {
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
    const [itemIds, settlements, claim] = await Promise.all([
      this.itemIdsOf(saved.id),
      this.settlementsOf(saved.id),
      this.claims.claimOf(saved.id),
    ]);
    this.emit(
      RealtimeEvent.LineUpdated,
      list.zoneId,
      saved,
      itemIds,
      settlements,
      claim
    );
    return toLineView(saved, itemIds, settlements, claim);
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
    const pageIds = page.map((line) => line.id);
    // Three queries for the page, not three per row: the product sets, the
    // settlement summary two of the indicators are drawn from, and the live
    // baskets the third one is (plan 0052, section 4). This is the read that
    // makes the claim survive a reconnect, so a phone that was asleep while
    // somebody generated a basket draws the same row as one that was watching.
    const [sets, settlements, claims] = await Promise.all([
      this.itemIdsOfMany(pageIds),
      this.settlementsOfMany(pageIds),
      this.claims.claimsOf(pageIds),
    ]);
    const items = page.map((line) =>
      toLineView(
        line,
        sets.get(line.id) ?? [],
        settlements.get(line.id) ?? NO_LINE_SETTLEMENTS,
        claims.get(line.id) ?? NO_LINE_CLAIM
      )
    );
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
