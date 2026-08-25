import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type CreateItemRequest,
  type ItemIdRequest,
  type ItemOrder,
  type ItemPage,
  type ItemView,
  type SearchItemsRequest,
  type UpdateItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { Item } from '../entities';
import { PlatformAdminService } from './platform-admin.service';
import { toItemView } from './catalog.mappers';

interface ItemCursor {
  order: ItemOrder;
  value: string;
  id: string;
}

/**
 * Global products (plan 0012). Writes are owner only; reads (search) are open to
 * any authenticated user and match the localized name in either language.
 */
@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    private readonly admin: PlatformAdminService
  ) {}

  async create(req: CreateItemRequest): Promise<ItemView> {
    this.admin.requireAdmin(req.userId);
    const saved = await this.items.save(
      this.items.create({
        name: req.name,
        brand: req.brand ?? null,
        imageUrl: req.imageUrl ?? null,
        sku: req.sku ?? null,
        category: req.category,
        defaultUnit: req.defaultUnit,
      })
    );
    return toItemView(saved);
  }

  async update(req: UpdateItemRequest): Promise<ItemView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.itemId);
    if (req.name !== undefined) {
      row.name = req.name;
    }
    if (req.brand !== undefined) {
      row.brand = req.brand;
    }
    if (req.imageUrl !== undefined) {
      row.imageUrl = req.imageUrl;
    }
    if (req.sku !== undefined) {
      row.sku = req.sku;
    }
    if (req.category !== undefined) {
      row.category = req.category;
    }
    if (req.defaultUnit !== undefined) {
      row.defaultUnit = req.defaultUnit;
    }
    return toItemView(await this.items.save(row));
  }

  async delete(req: ItemIdRequest): Promise<{ id: string }> {
    this.admin.requireAdmin(req.userId);
    const result = await this.items.delete({ id: req.itemId });
    if (!result.affected) {
      throw new NotFoundException('Item not found');
    }
    return { id: req.itemId };
  }

  async get(req: ItemIdRequest): Promise<ItemView> {
    return toItemView(await this.load(req.itemId));
  }

  /**
   * Search items (plan 0012, section 3): open to any authenticated user. Matches
   * the free-text `query` against the English or Spanish name (case insensitive)
   * and optionally filters by category. Cursor paginated.
   */
  async search(req: SearchItemsRequest): Promise<ItemPage> {
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ItemCursor | undefined;

    const qb = this.items.createQueryBuilder('i').take(limit + 1);
    const term = req.query?.trim();
    if (term) {
      qb.andWhere(
        `(i.name ->> 'en' ILIKE :term OR i.name ->> 'es' ILIKE :term)`,
        { term: `%${term}%` }
      );
    }
    if (req.category) {
      qb.andWhere('i.category = :category', { category: req.category });
    }
    this.applyOrder(qb, order, cursor);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            order,
            value: this.cursorValue(order, last),
            id: last.id,
          })
        : null;

    return { items: page.map(toItemView), nextCursor };
  }

  private async load(id: string): Promise<Item> {
    const row = await this.items.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Item not found');
    }
    return row;
  }

  private resolveOrder(order?: string): ItemOrder {
    return order === 'created' || order === 'updated' ? order : 'name';
  }

  private applyOrder(
    qb: SelectQueryBuilder<Item>,
    order: ItemOrder,
    cursor?: ItemCursor
  ): void {
    if (order === 'created') {
      qb.orderBy('i.createdAt', 'DESC').addOrderBy('i.id', 'DESC');
      if (cursor) {
        qb.andWhere('(i."createdAt", i.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'updated') {
      qb.orderBy('i.updatedAt', 'DESC').addOrderBy('i.id', 'DESC');
      if (cursor) {
        qb.andWhere('(i."updatedAt", i.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      qb.orderBy(`i.name ->> 'en'`, 'ASC').addOrderBy('i.id', 'ASC');
      if (cursor) {
        qb.andWhere(`(i.name ->> 'en', i.id) > (:cv, :cid)`, {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: ItemOrder, row: Item): string {
    if (order === 'created') {
      return row.createdAt.toISOString();
    }
    if (order === 'updated') {
      return row.updatedAt.toISOString();
    }
    return row.name.en;
  }
}
