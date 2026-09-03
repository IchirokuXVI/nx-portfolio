import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AdminBasketDetailView,
  AdminBasketLineView,
  AdminBasketPage,
  AdminBasketView,
  AdminListDetailView,
  AdminListLineView,
  AdminListPage,
  AdminListView,
  GetAdminBasketRequest,
  GetAdminListRequest,
  ListAdminBasketsRequest,
  ListAdminListsRequest,
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
import { CorePlatformAdminService } from './platform-admin.service';

/** Where a page left off: newest first, ties broken by id. */
interface RowCursor {
  value: string;
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
 * Read only, entirely. There is no line write here, no reorder, no approval and
 * no delete, and section 9 says there will not be: a line participates in
 * settlements, generated list bindings and permission sets, and the invariants
 * that hold those together live in `LineService` and its neighbours rather than in
 * constraints.
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
    private readonly gate: CorePlatformAdminService
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
