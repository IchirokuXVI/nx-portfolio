import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AdminBasketDetailView,
  AdminBasketPage,
  AdminBasketRowView,
  AdminBasketSettlementView,
  AdminBasketView,
  AdminListDetailView,
  AdminListIdRequest,
  AdminListLinePage,
  AdminListLineView,
  AdminListPage,
  AdminListView,
  DeleteAdminListLineRequest,
  GetAdminBasketRequest,
  GetAdminListLineRequest,
  GetAdminListRequest,
  LineView,
  ListAdminBasketsRequest,
  ListAdminListLinesRequest,
  ListAdminListsRequest,
  ListView,
  SetAdminLineApprovalRequest,
  SettlementOutcome,
  UpdateAdminListLineRequest,
  UpdateAdminListRequest,
} from '@portfolio/luna-shopper/contracts';
import { BasketStatus } from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { BasketReadService } from '../baskets/basket-read.service';
import {
  BasketSource,
  Basket,
  ListLine,
  ShoppingList,
} from '../entities';
import { BasketService } from '../baskets/basket.service';
import { LineService } from '../lists/line.service';
import { ListService } from '../lists/list.service';
import { CorePlatformAdminService } from './platform-admin.service';

/** Where a page left off: newest first, ties broken by id. */
interface RowCursor {
  value: string;
  id: string;
}

/**
 * Where a page of lines left off: the list, then the household's own order,
 * ties broken by id.
 *
 * `position` rather than a timestamp, because that is the order the list means
 * and the order every other view of it uses. It is a number rather than a
 * string, so it is its own field on the cursor rather than reusing
 * {@link RowCursor}.
 *
 * The list leads because the collection reads across lists when none is named
 * (admin plan 0017, section 3.1). A `position` is a place inside one list, so
 * ordering four lists by it alone would interleave them into an order that
 * means nothing. Inside one list that first key is constant, so a scoped read
 * pages exactly as it did before it was there.
 */
interface LineCursor {
  list: string;
  position: number;
  id: string;
}

/**
 * Shopping lists and baskets, for the back office (plan 0074).
 *
 * Two aggregates rather than one, because core has two things a person would
 * call a list: a `ShoppingList` is the standing list inside a zone, and a
 * `Basket` is the basket somebody took to the shop. The plan lists them
 * separately for that reason, and they filter differently because they are shaped
 * differently: a list is in a zone, and a basket belongs to a person and merely
 * drew its lines from zones.
 *
 * **Lines are on the detail reads and nowhere else** (plan 0074, section 4). The
 * two listings carry a count, so an operator can see that a list is large without
 * having read it, and opening one is a deliberate act.
 *
 * **Lists are editable and baskets are not**, which is plan 0077 rather than an
 * inconsistency. A list's writes all delegate to `ListService` and `LineService`,
 * so an operator's edit is the edit a member with `MANAGE` makes and it emits
 * what that emits. A basket has no such service to delegate to, because the app
 * offers no basket line editor either: since plan 0136 a `Basket` is a
 * **view** of the lines of the lists its `basket_sources` name, and there is no
 * row of its own here to edit at all. So baskets stay read only in full (plan
 * 0077, section 6.4).
 *
 * Creating a list line is absent for a narrower reason: `createdByUserId` is not
 * nullable and an operator is not a user, so a created line would be attributed
 * to nobody, or to an admin id that resolves to no user, and every list screen
 * renders that attribution.
 */
@Injectable()
export class AdminListService {
  constructor(
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    @InjectRepository(ListLine)
    private readonly lines: Repository<ListLine>,
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    // What a basket was asked to draw from (plan 0133), which is the only thing
    // that puts a basket in a zone now that it holds no lines of its own.
    @InjectRepository(BasketSource)
    private readonly sources: Repository<BasketSource>,
    private readonly gate: CorePlatformAdminService,
    private readonly listService: ListService,
    private readonly lineService: LineService,
    // The history counts, so the back office and the owner's own history cannot
    // disagree about how large a basket is (plan 0136, section 7.5). A value
    // import, never a `type` one: a `type` import on a constructor dependency
    // erases its DI token.
    private readonly generated: BasketService,
    // The rows of an **open** basket, unredacted: an operator reads what the
    // shopper reads.
    private readonly basketRead: BasketReadService
  ) {}

  /**
   * A page of shopping lists, newest first, by zone or by author.
   *
   * The zone is joined rather than looked up per row, because the zone is in this
   * database and a list without the name of the household it belongs to is not
   * usable on a screen. The **author's** name is not joined and cannot be: that
   * one lives in auth, and decorating it is the gateway's batched second call
   * (section 3).
   */
  async list(req: ListAdminListsRequest): Promise<AdminListPage> {
    await this.gate.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as RowCursor | undefined;
    const qb = this.lists
      .createQueryBuilder('l')
      .innerJoin('zones', 'z', 'z.id = l."zoneId"')
      .select('l.id', 'id')
      .addSelect('l."zoneId"', 'zoneId')
      .addSelect('z.name', 'zoneName')
      .addSelect('l.name', 'name')
      .addSelect('l."createdByUserId"', 'createdByUserId')
      .addSelect('l."autoApproveLines"', 'autoApproveLines')
      .addSelect('l."sharedWithZone"', 'sharedWithZone')
      .addSelect('l."createdAt"', 'createdAt')
      .addSelect('l."updatedAt"', 'updatedAt')
      .addSelect(
        '(SELECT COUNT(*) FROM list_lines n WHERE n."listId" = l.id AND n."deletedAt" IS NULL)',
        'lineCount'
      )
      .orderBy('l."createdAt"', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .limit(limit + 1);

    if (req.zoneId) {
      qb.andWhere('l."zoneId" = :zoneId', { zoneId: req.zoneId });
    }
    if (req.createdByUserId) {
      qb.andWhere('l."createdByUserId" = :author', {
        author: req.createdByUserId,
      });
    }
    if (cursor) {
      qb.andWhere('(l."createdAt", l.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getRawMany<RawListRow>();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toListRow),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              value: new Date(last.createdAt).toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /**
   * One list and its lines, in the order the household sees them.
   *
   * Every line, whatever its approval status: a rejected line is often the reason
   * somebody is looking at this screen, and hiding it would make the list an
   * operator sees differ from the one the household is arguing about.
   */
  async get(req: GetAdminListRequest): Promise<AdminListDetailView> {
    await this.gate.requireAdmin(req);

    const [row] = await this.lists
      .createQueryBuilder('l')
      .innerJoin('zones', 'z', 'z.id = l."zoneId"')
      .select('l.id', 'id')
      .addSelect('l."zoneId"', 'zoneId')
      .addSelect('z.name', 'zoneName')
      .addSelect('l.name', 'name')
      .addSelect('l."createdByUserId"', 'createdByUserId')
      .addSelect('l."autoApproveLines"', 'autoApproveLines')
      .addSelect('l."sharedWithZone"', 'sharedWithZone')
      .addSelect('l."createdAt"', 'createdAt')
      .addSelect('l."updatedAt"', 'updatedAt')
      .addSelect(
        '(SELECT COUNT(*) FROM list_lines n WHERE n."listId" = l.id AND n."deletedAt" IS NULL)',
        'lineCount'
      )
      .where('l.id = :id', { id: req.listId })
      .getRawMany<RawListRow>();

    if (!row) {
      throw new NotFoundException('List not found');
    }

    const lines = await this.lines.find({
      where: { listId: req.listId },
      order: { position: 'ASC', id: 'ASC' },
    });
    return {
      ...toListRow(row),
      lines: lines.map((line) => toLineView(line, row.name)),
    };
  }

  /**
   * A list's name and its two flags, through `ListService` (plan 0077, section
   * 5.1), which is everything `UpdateListRequest` carries.
   *
   * `sharedWithZone` is a real field and not a trap, and it is **asymmetric**:
   * turning it on grants `{READ, WRITE, DECIDE}` to every currently approved non
   * staff member, and turning it off revokes nobody. That is the member facing
   * behaviour and this does not soften it. The mistake it exists to prevent is an
   * operator who toggles it off and expects the list to close, which is why the
   * back office states the rule beside the field rather than here alone.
   *
   * The per member grant set is not reachable from this plan. It is a set of
   * entries rather than a field, and editing it well needs a screen of its own.
   */
  async update(req: UpdateAdminListRequest): Promise<ListView> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireList(req.listId);
    return this.listService.updateAsOperator(
      req.listId,
      {
        name: req.name,
        autoApproveLines: req.autoApproveLines,
        sharedWithZone: req.sharedWithZone,
      },
      actorId
    );
  }

  /** Delete a list, through `ListService` (plan 0077, section 5.1). */
  async remove(req: AdminListIdRequest): Promise<{ id: string }> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireList(req.listId);
    return this.listService.deleteAsOperator(req.listId, actorId);
  }

  /**
   * A page of lines, from one list or from every list (plan 0077, section 9,
   * widened by admin plan 0017).
   *
   * The detail read keeps its embedded `lines` array, unchanged. This
   * collection serves the screen that edits one line, and it pages in the
   * household's own order rather than by time, because that is the order the
   * line's position means and the order every other view of the list uses.
   *
   * **`listId` is a filter and not an address.** Somebody looking for the lines
   * one person wrote does not know which lists they are on, so a read with no
   * list lists every list's, grouped by the list they are on because a
   * `position` means nothing across lists.
   *
   * `requireList` runs only when a list is named, so an unknown list is a 404
   * and an absent one is not.
   */
  async listLines(req: ListAdminListLinesRequest): Promise<AdminListLinePage> {
    await this.gate.requireAdmin(req);
    if (req.listId !== undefined) {
      await this.requireList(req.listId);
    }

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LineCursor | undefined;
    const qb = this.lines
      .createQueryBuilder('n')
      .orderBy('n."listId"', 'ASC')
      .addOrderBy('n.position', 'ASC')
      .addOrderBy('n.id', 'ASC')
      .take(limit + 1);
    if (req.listId !== undefined) {
      qb.andWhere('n."listId" = :listId', { listId: req.listId });
    }
    if (cursor) {
      qb.andWhere('(n."listId", n.position, n.id) > (:cl, :cv, :cid)', {
        cl: cursor.list,
        cv: cursor.position,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const names = await this.listNames(page.map((row) => row.listId));

    return {
      items: page.map((row) => toLineView(row, names.get(row.listId) ?? '')),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              list: last.listId,
              position: last.position,
              id: last.id,
            })
          : null,
    };
  }

  /** One line, read through its own address (plan 0077, section 9). */
  async getLine(req: GetAdminListLineRequest): Promise<AdminListLineView> {
    await this.gate.requireAdmin(req);
    const list = await this.requireList(req.listId);
    return toLineView(
      await this.requireLine(req.listId, req.lineId),
      list.name
    );
  }

  /**
   * Edit a line's content, quantity or product set, through `LineService` (plan
   * 0077, section 5.2).
   *
   * **The operator edits with `MANAGE`**, which `LineService.updateAsOperator`
   * resolves for itself. That decides two separate questions at once, and both
   * answers are the ones an operator wants: the edit is allowed, and an approved
   * line stays approved. Resolving the operator as a plain writer was rejected for
   * the second half alone, because an operator fixing a typo in an approved line
   * would move it to `PENDING` and the household would have to approve their own
   * line again, for reasons no screen can explain.
   *
   * A `REJECTED` line still reopens, because that rule applies to everyone.
   */
  async updateLine(req: UpdateAdminListLineRequest): Promise<LineView> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireLine(req.listId, req.lineId);
    return this.lineService.updateAsOperator(
      req.listId,
      req.lineId,
      {
        content: req.content,
        quantity: req.quantity,
        itemIds: req.itemIds,
      },
      actorId
    );
  }

  /** Approve or reject a line, through `LineService` (plan 0077, section 5.2). */
  async setLineApproval(req: SetAdminLineApprovalRequest): Promise<LineView> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireLine(req.listId, req.lineId);
    return this.lineService.setApprovalAsOperator(
      req.listId,
      req.lineId,
      req.status,
      actorId
    );
  }

  /** Delete a line, through `LineService` (plan 0077, section 5.2). */
  async deleteLine(req: DeleteAdminListLineRequest): Promise<{ id: string }> {
    const actorId = await this.gate.requireAdmin(req);
    await this.requireLine(req.listId, req.lineId);
    return this.lineService.deleteAsOperator(req.listId, req.lineId, actorId);
  }

  /**
   * A list that exists, or a 404.
   *
   * Asked for explicitly, for the reason `AdminZoneService.requireZone` gives:
   * the user facing routes get this from the permission resolution they perform
   * first, and the operator paths skip that by design, so an action on a mistyped
   * id would otherwise report whatever the delegated service happened to say.
   */
  /**
   * The names of the lists a page of lines belongs to.
   *
   * A second query rather than a join, so the rows stay entities: `position` is
   * a `double precision` the cursor is built from, and a raw read would hand it
   * back as whatever the driver made of the column.
   */
  private async listNames(listIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(listIds)];
    if (!unique.length) {
      return new Map();
    }
    const rows = await this.lists
      .createQueryBuilder('l')
      .select('l.id', 'id')
      .addSelect('l.name', 'name')
      .where('l.id IN (:...ids)', { ids: unique })
      .getRawMany<{ id: string; name: string }>();
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async requireList(listId: string): Promise<ShoppingList> {
    const list = await this.lists.findOne({ where: { id: listId } });
    if (!list) {
      throw new NotFoundException('List not found');
    }
    return list;
  }

  /**
   * One line **on this list**, or a 404.
   *
   * Scoped to the list rather than looked up by id alone. A line id from another
   * list is not found here, so a mistyped list id cannot silently address a line
   * in somebody else's household.
   */
  private async requireLine(listId: string, lineId: string): Promise<ListLine> {
    const line = await this.lines.findOne({ where: { id: lineId, listId } });
    if (!line) {
      throw new NotFoundException('Line not found on this list');
    }
    return line;
  }

  /**
   * A page of baskets, newest generated first, by owner or by zone.
   *
   * **The zone filter goes through `basket_sources`** (plan 0136, section 7.5),
   * not through the basket itself, because a basket has no zone: it belongs to a
   * person, and what it was asked to draw from is the only record of which zones
   * it looks at. It used to go through the line origins, and there are none any
   * more. The other candidate, the default target list's zone, is null on every
   * basket nobody chose a destination for, which is most of them.
   *
   * A `LIVE` basket has no sources, so a zone filter never answers one. It is
   * listed unfiltered with its `kind` shown, because an operator looking for
   * "what is this person shopping" needs that before anything else.
   */
  async listBaskets(req: ListAdminBasketsRequest): Promise<AdminBasketPage> {
    await this.gate.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as RowCursor | undefined;
    const qb = this.baskets
      .createQueryBuilder('b')
      .orderBy('b."generatedAt"', 'DESC')
      .addOrderBy('b.id', 'DESC')
      .take(limit + 1);

    if (req.ownerUserId) {
      qb.andWhere('b."ownerUserId" = :owner', { owner: req.ownerUserId });
    }
    if (req.zoneId) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM basket_sources bs
           WHERE bs."basketId" = b.id AND bs."zoneId" = :zoneId)`,
        { zoneId: req.zoneId }
      );
    }
    if (cursor) {
      qb.andWhere('(b."generatedAt", b.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    const ids = page.map((basket) => basket.id);
    const [counts, zones] = await Promise.all([
      this.generated.countsFor(page),
      this.zonesForBaskets(ids),
    ]);

    return {
      items: page.map((basket) =>
        toBasketRow(
          basket,
          counts.get(basket.id)?.lineCount ?? 0,
          zones.get(basket.id) ?? []
        )
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.generatedAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * One basket and its rows (plan 0136, section 7.5).
   *
   * **Two sources, split on the status**, as the history counts are. An `OPEN`
   * basket has nothing written down anywhere, so the operator is shown what the
   * shopper is shown, unredacted: `BasketReadService.openRows` composes it from
   * the lines the basket covers. A basket that is over answers from
   * `basket_trip_rows`, which its finish froze, against the settlements standing
   * under its own id.
   *
   * The field is still called `lines`, because the route is, and renaming a wire
   * field is plan 0144's.
   */
  async getBasket(req: GetAdminBasketRequest): Promise<AdminBasketDetailView> {
    await this.gate.requireAdmin(req);

    const basket = await this.baskets.findOne({ where: { id: req.basketId } });
    if (!basket) {
      throw new NotFoundException('Basket not found');
    }

    const [counts, zones, lines] = await Promise.all([
      this.generated.countsFor([basket]),
      this.zonesForBaskets([basket.id]),
      this.rowsOfBasket(basket),
    ]);
    return {
      ...toBasketRow(
        basket,
        counts.get(basket.id)?.lineCount ?? 0,
        zones.get(basket.id) ?? []
      ),
      lines,
    };
  }

  /** The rows an operator is shown, whichever half of the split answers them. */
  private async rowsOfBasket(
    basket: Basket
  ): Promise<AdminBasketRowView[]> {
    if (basket.status === BasketStatus.OPEN) {
      const open = await this.basketRead.openRows(basket);
      const linesOf = (row: (typeof open)[number]) => [
        ...new Set([row.rowKey, ...row.entries.map((entry) => entry.lineId)]),
      ];
      const settled = await this.settlementsOf(
        basket.id,
        open.flatMap(linesOf)
      );
      return open.map((row) => ({
        rowKey: row.rowKey,
        content: row.content,
        left: row.left,
        bought: row.bought,
        asked: row.asked,
        settlements: bySettledAt(
          linesOf(row).flatMap((lineId) => settled.get(lineId) ?? [])
        ),
      }));
    }
    const rows = await this.baskets.query<FrozenRow[]>(
      FINISHED_BASKET_ROWS_SQL,
      [basket.id]
    );
    const settled = await this.settlementsOf(
      basket.id,
      rows.map((row) => row.lineId)
    );
    return rows.map((row) => ({
      rowKey: row.lineId,
      content: row.content,
      left: Math.max(row.asked - row.bought, 0),
      bought: row.bought,
      asked: row.asked,
      settlements: settled.get(row.lineId) ?? [],
    }));
  }

  /**
   * Every settlement made through this basket on these lines, by line, oldest
   * first (plan 0160).
   *
   * Reverted ones too, marked by `revertedAt`: "somebody said they got this
   * and took it back" is part of what an operator is checking. Filtered on the
   * lines first, so `ix_settlements_line` serves it; the basket's own partial
   * index leaves the reverted rows out.
   */
  private async settlementsOf(
    basketId: string,
    lineIds: readonly string[]
  ): Promise<Map<string, AdminBasketSettlementView[]>> {
    const byLine = new Map<string, AdminBasketSettlementView[]>();
    if (lineIds.length === 0) {
      return byLine;
    }
    const rows = await this.baskets.query<SettlementRow[]>(
      BASKET_SETTLEMENTS_SQL,
      [basketId, [...new Set(lineIds)]]
    );
    for (const row of rows) {
      const held = byLine.get(row.lineId) ?? [];
      held.push({
        id: row.id,
        lineId: row.lineId,
        itemId: row.itemId,
        outcome: row.outcome,
        quantity: row.quantity,
        pricePaidCents: row.pricePaidCents,
        pricePaidCurrency: row.pricePaidCurrency,
        priceScopeId: row.priceScopeId,
        supermarketLocationId: row.supermarketLocationId,
        settledByUserId: row.settledByUserId,
        settledByParticipantId: row.settledByParticipantId,
        settledAt: row.settledAt.toISOString(),
        revertedAt: row.revertedAt ? row.revertedAt.toISOString() : null,
      });
      byLine.set(row.lineId, held);
    }
    return byLine;
  }

  /**
   * The distinct zones each basket was asked to draw from, in one query for the
   * whole page.
   *
   * Empty is a real answer and not a failure: the permanent basket has no
   * sources at all (plan 0133), so it reports no zones.
   */
  private async zonesForBaskets(ids: string[]): Promise<Map<string, string[]>> {
    if (!ids.length) {
      return new Map();
    }
    const rows = await this.sources
      .createQueryBuilder('bs')
      .select('bs."basketId"', 'basketId')
      .addSelect('bs."zoneId"', 'zoneId')
      .where('bs."basketId" IN (:...ids)', { ids })
      .groupBy('bs."basketId"')
      .addGroupBy('bs."zoneId"')
      .getRawMany<{ basketId: string; zoneId: string }>();

    const byBasket = new Map<string, string[]>();
    for (const row of rows) {
      const zones = byBasket.get(row.basketId) ?? [];
      zones.push(row.zoneId);
      byBasket.set(row.basketId, zones);
    }
    return byBasket;
  }
}

/**
 * The frozen rows of one finished basket, with what was bought of each. `$1` is
 * the basket.
 *
 * One row per zone line, as `basket_trip_rows` is, and `left` is derived rather
 * than stored, exactly as `trips.mappers.ts` derives it. The text comes from the
 * line itself, because a trip row carries none: a basket never had text of its
 * own that the list did not have first.
 *
 * Every camelCase column is quoted by hand, for the reason the SQL in
 * `basket.sql.ts` gives at length: TypeORM does not rewrite
 * `alias.property` inside a raw select expression.
 */
const FINISHED_BASKET_ROWS_SQL = `
  SELECT r."lineId" AS "lineId",
         ll.content AS "content",
         r."asked" AS "asked",
         COALESCE((
           SELECT SUM(s."quantity")
           FROM "line_settlements" s
           WHERE s."basketId" = r."basketId"
             AND s."lineId" = r."lineId"
             AND s."revertedAt" IS NULL
             AND s."outcome" = 'BOUGHT'
         ), 0)::int AS "bought"
  FROM "basket_trip_rows" r
  JOIN "list_lines" ll ON ll.id = r."lineId"
  WHERE r."basketId" = $1::uuid
  ORDER BY ll."createdAt", ll.id
`;

/** One row of {@link FINISHED_BASKET_ROWS_SQL}. */
interface FrozenRow {
  lineId: string;
  content: string;
  asked: number;
  bought: number;
}

/**
 * The settlements one basket made on some of its lines (plan 0160). `$1` is
 * the basket, `$2` the lines. Oldest first, so a row reads as a history.
 */
const BASKET_SETTLEMENTS_SQL = `
  SELECT s.id AS "id",
         s."lineId" AS "lineId",
         s."itemId" AS "itemId",
         s."outcome" AS "outcome",
         s."quantity" AS "quantity",
         s."pricePaidCents" AS "pricePaidCents",
         s."pricePaidCurrency" AS "pricePaidCurrency",
         s."priceScopeId" AS "priceScopeId",
         s."supermarketLocationId" AS "supermarketLocationId",
         s."settledByUserId" AS "settledByUserId",
         s."settledByParticipantId" AS "settledByParticipantId",
         s."settledAt" AS "settledAt",
         s."revertedAt" AS "revertedAt"
  FROM "line_settlements" s
  WHERE s."lineId" = ANY($2::uuid[])
    AND s."basketId" = $1::uuid
  ORDER BY s."settledAt", s.id
`;

/** One row of {@link BASKET_SETTLEMENTS_SQL}. */
interface SettlementRow {
  id: string;
  lineId: string;
  itemId: string | null;
  outcome: SettlementOutcome;
  quantity: number;
  pricePaidCents: number | null;
  pricePaidCurrency: string | null;
  priceScopeId: string | null;
  supermarketLocationId: string | null;
  settledByUserId: string | null;
  settledByParticipantId: string | null;
  settledAt: Date;
  revertedAt: Date | null;
}

/** Oldest first, across the several lines one open row can cover. */
function bySettledAt(
  settlements: AdminBasketSettlementView[]
): AdminBasketSettlementView[] {
  return [...settlements].sort(
    (a, b) => a.settledAt.localeCompare(b.settledAt) || a.id.localeCompare(b.id)
  );
}

/** The raw shape both list reads select, before the counts are numbers. */
interface RawListRow {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  createdByUserId: string;
  autoApproveLines: boolean;
  sharedWithZone: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  lineCount: string;
}

function toListRow(row: RawListRow): AdminListView {
  return {
    id: row.id,
    zoneId: row.zoneId,
    zoneName: row.zoneName,
    name: row.name,
    createdByUserId: row.createdByUserId,
    autoApproveLines: row.autoApproveLines,
    sharedWithZone: row.sharedWithZone,
    lineCount: Number(row.lineCount),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function toLineView(line: ListLine, listName: string): AdminListLineView {
  return {
    id: line.id,
    listId: line.listId,
    listName,
    content: line.content,
    quantity: line.quantity,
    approvalStatus: line.approvalStatus,
    createdByUserId: line.createdByUserId,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

function toBasketRow(
  basket: Basket,
  lineCount: number,
  zoneIds: string[]
): AdminBasketView {
  return {
    id: basket.id,
    ownerUserId: basket.ownerUserId,
    kind: basket.kind,
    name: basket.name,
    status: basket.status,
    zoneIds,
    lineCount,
    generatedAt: basket.generatedAt.toISOString(),
    createdAt: basket.createdAt.toISOString(),
    updatedAt: basket.updatedAt.toISOString(),
  };
}
