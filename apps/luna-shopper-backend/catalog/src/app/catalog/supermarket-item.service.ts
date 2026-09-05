import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AdminListSupermarketItemsRequest,
  GetSupermarketItemRequest,
  ListSupermarketItemsByItemRequest,
  ListSupermarketItemsByLocationRequest,
  ListSupermarketItemsByScopeRequest,
  SetSupermarketItemAvailabilityRequest,
  SetSupermarketItemAvailabilityResult,
  SupermarketItemPage,
  SupermarketItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import {
  Item,
  PriceScope,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toSupermarketItemView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';

interface SupermarketItemCursor {
  value: string;
  id: string;
}

/**
 * The materialized row: the price a shopper sees for one item in one scope
 * (plan 0038, section 5.2, sharpened by plan 0080, section 7). Reads are open.
 *
 * **Nothing here writes a price.** Every price a source gives is a row in
 * `item_prices`, written through `ItemPriceService`, and the row this service
 * reads is recomputed inside that write. Plan 0038 section 6.5's rule, that an
 * automated fetch never overwrites a price a person typed in, is gone with the
 * overwriting: an automated row and an `ADMIN` row now coexist, and section 4
 * of plan 0080 decides between them on every read.
 *
 * The one write left is availability, because it is a fact about stock and
 * not about price: a 404 from a detail call sets it and states no price.
 */
@Injectable()
export class SupermarketItemService {
  constructor(
    @InjectRepository(SupermarketItem)
    private readonly supermarketItems: Repository<SupermarketItem>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(PriceScope)
    private readonly scopes: Repository<PriceScope>,
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /**
   * Whether a scope carries each of these products (plan 0080, section 9).
   *
   * A row that does not exist yet is created with no price: the scope has an
   * opinion about stock and none about price, and the materialized row can
   * hold exactly that. A row already saying so is left alone and counts for
   * nothing, so a run that re-reports the same 404s writes no audit rows.
   */
  async setAvailability(
    req: SetSupermarketItemAvailabilityRequest
  ): Promise<SetSupermarketItemAvailabilityResult> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireScope(req.priceScopeId);
    if (req.entries.length === 0) {
      return { updated: 0 };
    }

    const wanted = new Map(req.entries.map((e) => [e.itemId, e.available]));
    const itemIds = [...wanted.keys()];
    const existing = await this.supermarketItems.find({
      where: itemIds.map((itemId) => ({
        itemId,
        priceScopeId: req.priceScopeId,
      })),
    });
    const byItem = new Map(existing.map((row) => [row.itemId, row]));

    const fresh: SupermarketItem[] = [];
    const changed: { before: SupermarketItem; row: SupermarketItem }[] = [];
    for (const [itemId, available] of wanted) {
      const held = byItem.get(itemId);
      if (!held) {
        fresh.push(
          this.supermarketItems.create({
            itemId,
            priceScopeId: req.priceScopeId,
            available,
            priceSourceKind: null,
          })
        );
        continue;
      }
      if (held.available === available) {
        continue;
      }
      const before = { ...held };
      held.available = available;
      changed.push({ before, row: held });
    }
    if (fresh.length === 0 && changed.length === 0) {
      return { updated: 0 };
    }

    await this.audit.write(actor, async (tx) => {
      const rows = [...fresh, ...changed.map((c) => c.row)];
      await tx.manager.save(SupermarketItem, rows, { chunk: 200 });
      for (const row of fresh) {
        await tx.recordCreate(SupermarketItem, row);
      }
      for (const { before, row } of changed) {
        await tx.recordUpdate(SupermarketItem, before, row);
      }
    });
    return { updated: fresh.length + changed.length };
  }

  /** Read one item's price in a scope (plan 0012, section 3): open. */
  async get(req: GetSupermarketItemRequest): Promise<SupermarketItemView> {
    const row = await this.supermarketItems.findOne({
      where: { itemId: req.itemId, priceScopeId: req.priceScopeId },
    });
    if (!row) {
      throw new NotFoundException('No price for that item in that scope');
    }
    return toSupermarketItemView(row);
  }

  async listByItem(
    req: ListSupermarketItemsByItemRequest
  ): Promise<SupermarketItemPage> {
    return this.page('itemId', req.itemId, req.cursor, req.limit);
  }

  /**
   * Still answered by location, because that is the question a shopper asks:
   * "what does this shop charge". The location resolves to its scope and the
   * scope's rows are paged, so the subject survived the re-keying unchanged.
   */
  async listByLocation(
    req: ListSupermarketItemsByLocationRequest
  ): Promise<SupermarketItemPage> {
    const location = await this.locations.findOne({
      where: { id: req.supermarketLocationId },
    });
    if (!location) {
      throw new NotFoundException('Supermarket location not found');
    }
    return this.page(
      'priceScopeId',
      location.priceScopeId,
      req.cursor,
      req.limit
    );
  }

  async listByScope(
    req: ListSupermarketItemsByScopeRequest
  ): Promise<SupermarketItemPage> {
    return this.page('priceScopeId', req.priceScopeId, req.cursor, req.limit);
  }

  /**
   * The back office's effective price list (plan 0073, section 4; plan 0080,
   * section 10).
   *
   * Gated, unlike the three lists above it, and gated for what it returns rather
   * than for what it changes: with no filter at all it pages the entire price
   * table, which is not a shape any user facing screen has a use for. The gate
   * is also what makes `sourceKind` and `stale` answerable: "what have I
   * overridden" and "what is shown on sufferance" are questions about the
   * operator's own catalog.
   */
  async adminList(
    req: AdminListSupermarketItemsRequest
  ): Promise<SupermarketItemPage> {
    await this.admin.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as
      | SupermarketItemCursor
      | undefined;

    const qb = this.supermarketItems
      .createQueryBuilder('si')
      .orderBy('si.createdAt', 'DESC')
      .addOrderBy('si.id', 'DESC')
      .take(limit + 1);
    if (req.itemId) {
      qb.andWhere('si."itemId" = :itemId', { itemId: req.itemId });
    }
    if (req.priceScopeId) {
      qb.andWhere('si."priceScopeId" = :scopeId', {
        scopeId: req.priceScopeId,
      });
    }
    if (req.sourceKind) {
      qb.andWhere('si."priceSourceKind" = :kind', { kind: req.sourceKind });
    }
    if (req.stale !== undefined) {
      qb.andWhere('si."stale" = :stale', { stale: req.stale });
    }
    if (req.available !== undefined) {
      qb.andWhere('si."available" = :available', { available: req.available });
    }
    if (cursor) {
      qb.andWhere('(si."createdAt", si.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const list = rows.slice(0, limit);
    const last = list[list.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items: list.map(toSupermarketItemView), nextCursor };
  }

  private async page(
    column: 'itemId' | 'priceScopeId',
    value: string,
    cursorToken: string | undefined,
    limitInput: number | undefined
  ): Promise<SupermarketItemPage> {
    const limit = clampPageSize(limitInput);
    const cursor = decodeCursor(cursorToken) as
      | SupermarketItemCursor
      | undefined;

    const qb = this.supermarketItems
      .createQueryBuilder('si')
      .where(`si."${column}" = :value`, { value })
      .orderBy('si.createdAt', 'DESC')
      .addOrderBy('si.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(si."createdAt", si.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const list = rows.slice(0, limit);
    const last = list[list.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items: list.map(toSupermarketItemView), nextCursor };
  }

  private async requireScope(priceScopeId: string): Promise<void> {
    const scope = await this.scopes.findOne({ where: { id: priceScopeId } });
    if (!scope) {
      throw new NotFoundException('Price scope not found');
    }
  }

  /** Kept for the item existence check the availability write does not need; the item repository stays injected for it. */
  protected async requireItem(itemId: string): Promise<void> {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
  }
}
