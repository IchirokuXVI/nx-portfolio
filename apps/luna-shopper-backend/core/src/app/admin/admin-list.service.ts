import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AdminBasketDetailView,
  AdminBasketLineView,
  AdminBasketPage,
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
  UpdateAdminListLineRequest,
  UpdateAdminListRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  ListLine,
  ShoppingList,
} from '../entities';
import { LineService } from '../lists/line.service';
import { ListService } from '../lists/list.service';
import { CorePlatformAdminService } from './platform-admin.service';

/** Where a page left off: newest first, ties broken by id. */
interface RowCursor {
  value: string;
  id: string;
}

/**
 * Where a page of lines left off: the household's own order, ties broken by id.
 *
 * `position` rather than a timestamp, because that is the order the list means
 * and the order every other view of it uses. It is a number rather than a string,
 * so it is its own field on the cursor rather than reusing {@link RowCursor}.
 */
interface LineCursor {
  position: number;
  id: string;
}

/**
 * Shopping lists and baskets, for the back office (plan 0074).
 *
 * Two aggregates rather than one, because core has two things a person would
 * call a list: a `ShoppingList` is the standing list inside a zone, and a
 * `GeneratedList` is the basket somebody took to the shop. The plan lists them
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
 * offers no basket line editor either: a `GeneratedList` is **output**, composed
 * from the lines of the lists somebody chose at the moment its `sourceSnapshot`
 * records, and a changed line contradicts both the origin that explains where it
 * came from and any settlement already written against it. So baskets stay read
 * only in full (plan 0077, section 6.4).
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
    @InjectRepository(GeneratedList)
    private readonly baskets: Repository<GeneratedList>,
    @InjectRepository(GeneratedListLine)
    private readonly basketLines: Repository<GeneratedListLine>,
    @InjectRepository(GeneratedListLineOrigin)
    private readonly origins: Repository<GeneratedListLineOrigin>,
    private readonly gate: CorePlatformAdminService,
    private readonly listService: ListService,
    private readonly lineService: LineService
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
        '(SELECT COUNT(*) FROM list_lines n WHERE n."listId" = l.id)',
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
        '(SELECT COUNT(*) FROM list_lines n WHERE n."listId" = l.id)',
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
    return { ...toListRow(row), lines: lines.map(toLineView) };
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
   * A page of one list's lines (plan 0077, section 9).
   *
   * The detail read keeps its embedded `lines` array, unchanged. This collection
   * serves the screen that edits one line, and it pages in the household's own
   * order rather than by time, because that is the order the line's position
   * means and the order every other view of the list uses.
   */
  async listLines(req: ListAdminListLinesRequest): Promise<AdminListLinePage> {
    await this.gate.requireAdmin(req);
    await this.requireList(req.listId);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LineCursor | undefined;
    const qb = this.lines
      .createQueryBuilder('n')
      .where('n."listId" = :listId', { listId: req.listId })
      .orderBy('n.position', 'ASC')
      .addOrderBy('n.id', 'ASC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(n.position, n.id) > (:cv, :cid)', {
        cv: cursor.position,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map(toLineView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ position: last.position, id: last.id })
          : null,
    };
  }

  /** One line, read through its own address (plan 0077, section 9). */
  async getLine(req: GetAdminListLineRequest): Promise<AdminListLineView> {
    await this.gate.requireAdmin(req);
    return toLineView(await this.requireLine(req.listId, req.lineId));
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
  private async requireLine(
    listId: string,
    lineId: string
  ): Promise<ListLine> {
    const line = await this.lines.findOne({ where: { id: lineId, listId } });
    if (!line) {
      throw new NotFoundException('Line not found on this list');
    }
    return line;
  }

  /**
   * A page of baskets, newest generated first, by owner or by zone.
   *
   * **The zone filter goes through the line origins**, not through the basket
   * itself, because a basket has no zone: it belongs to a person, and its lines
   * record which (zone, list) pair each of them came from. The other candidate,
   * the default target list's zone, is null on every basket nobody chose a
   * destination for, which is most of them.
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
           SELECT 1 FROM generated_list_line_origins o
           JOIN generated_list_lines gl ON gl.id = o."generatedListLineId"
           WHERE gl."generatedListId" = b.id AND o."zoneId" = :zoneId)`,
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
      this.countBasketLines(ids),
      this.zonesForBaskets(ids),
    ]);

    return {
      items: page.map((basket) =>
        toBasketRow(
          basket,
          counts.get(basket.id) ?? 0,
          zones.get(basket.id) ?? []
        )
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.generatedAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** One basket and its lines, in the order it was generated in. */
  async getBasket(req: GetAdminBasketRequest): Promise<AdminBasketDetailView> {
    await this.gate.requireAdmin(req);

    const basket = await this.baskets.findOne({ where: { id: req.basketId } });
    if (!basket) {
      throw new NotFoundException('Basket not found');
    }

    const lines = await this.basketLines.find({
      where: { generatedListId: basket.id },
      order: { position: 'ASC', id: 'ASC' },
    });
    const zones = await this.zonesForBaskets([basket.id]);
    return {
      ...toBasketRow(basket, lines.length, zones.get(basket.id) ?? []),
      lines: lines.map(toBasketLineView),
    };
  }

  private async countBasketLines(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) {
      return new Map();
    }
    const rows = await this.basketLines
      .createQueryBuilder('gl')
      .select('gl."generatedListId"', 'basketId')
      .addSelect('COUNT(*)', 'count')
      .where('gl."generatedListId" IN (:...ids)', { ids })
      .groupBy('gl."generatedListId"')
      .getRawMany<{ basketId: string; count: string }>();
    return new Map(rows.map((row) => [row.basketId, Number(row.count)]));
  }

  /**
   * The distinct zones each basket's lines were drawn from, in one query for the
   * whole page.
   *
   * Empty is a real answer and not a failure: a basket whose lines all came from
   * free text rather than from a list has no origins, and reports no zones.
   */
  private async zonesForBaskets(ids: string[]): Promise<Map<string, string[]>> {
    if (!ids.length) {
      return new Map();
    }
    const rows = await this.origins
      .createQueryBuilder('o')
      .innerJoin(
        'generated_list_lines',
        'gl',
        'gl.id = o."generatedListLineId"'
      )
      .select('gl."generatedListId"', 'basketId')
      .addSelect('o."zoneId"', 'zoneId')
      .where('gl."generatedListId" IN (:...ids)', { ids })
      .groupBy('gl."generatedListId"')
      .addGroupBy('o."zoneId"')
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

function toLineView(line: ListLine): AdminListLineView {
  return {
    id: line.id,
    content: line.content,
    quantity: line.quantity,
    approvalStatus: line.approvalStatus,
    createdByUserId: line.createdByUserId,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

function toBasketRow(
  basket: GeneratedList,
  lineCount: number,
  zoneIds: string[]
): AdminBasketView {
  return {
    id: basket.id,
    ownerUserId: basket.ownerUserId,
    name: basket.name,
    status: basket.status,
    zoneIds,
    lineCount,
    generatedAt: basket.generatedAt.toISOString(),
    createdAt: basket.createdAt.toISOString(),
    updatedAt: basket.updatedAt.toISOString(),
  };
}

function toBasketLineView(line: GeneratedListLine): AdminBasketLineView {
  return {
    id: line.id,
    content: line.content,
    quantity: line.quantity,
    createdAt: line.createdAt.toISOString(),
  };
}
