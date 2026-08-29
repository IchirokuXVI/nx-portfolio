import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  GetSupermarketLocationItemRequest,
  ListSupermarketLocationItemsRequest,
  SupermarketLocationItemPage,
  SupermarketLocationItemView,
  UpsertSupermarketLocationItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { Item, SupermarketLocation, SupermarketLocationItem } from '../entities';
import { toSupermarketLocationItemView } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';

interface LocationItemCursor {
  value: string;
  id: string;
}

/**
 * The per store half of a product's presence in a chain (plan 0038, section 5.2):
 * where it sits in *this* shop, and an optional per store availability override.
 *
 * It exists as its own surface because the price moving to the scope would
 * otherwise have made `positionInStore` unreachable: it left `SupermarketItem`
 * and nothing else could set it. A warehouse cannot answer which aisle a product
 * is in, so the question needed somewhere to live rather than nowhere.
 */
@Injectable()
export class SupermarketLocationItemService {
  constructor(
    @InjectRepository(SupermarketLocationItem)
    private readonly rows: Repository<SupermarketLocationItem>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    private readonly admin: PlatformAdminService
  ) {}

  async upsert(
    req: UpsertSupermarketLocationItemRequest
  ): Promise<SupermarketLocationItemView> {
    this.admin.requireAdmin(req.userId);
    await this.requireItemAndLocation(req.itemId, req.supermarketLocationId);

    const existing = await this.rows.findOne({
      where: {
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      },
    });
    const row =
      existing ??
      this.rows.create({
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      });

    if (req.positionInStore !== undefined) {
      row.positionInStore = req.positionInStore;
    }
    // Explicit null is meaningful: it clears the override and defers to the
    // scope's answer, which is not the same as saying "not available here".
    if (req.available !== undefined) {
      row.available = req.available;
    }

    return toSupermarketLocationItemView(await this.rows.save(row));
  }

  async get(
    req: GetSupermarketLocationItemRequest
  ): Promise<SupermarketLocationItemView> {
    const row = await this.rows.findOne({
      where: {
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      },
    });
    if (!row) {
      throw new NotFoundException(
        'No store specific entry for that item at that location'
      );
    }
    return toSupermarketLocationItemView(row);
  }

  async listByLocation(
    req: ListSupermarketLocationItemsRequest
  ): Promise<SupermarketLocationItemPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as LocationItemCursor | undefined;

    const qb = this.rows
      .createQueryBuilder('li')
      .where('li."supermarketLocationId" = :lid', {
        lid: req.supermarketLocationId,
      })
      .orderBy('li.createdAt', 'DESC')
      .addOrderBy('li.id', 'DESC')
      .take(limit + 1);
    if (cursor) {
      qb.andWhere('(li."createdAt", li.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const found = await qb.getMany();
    const hasMore = found.length > limit;
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toSupermarketLocationItemView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async requireItemAndLocation(
    itemId: string,
    supermarketLocationId: string
  ): Promise<void> {
    const [item, location] = await Promise.all([
      this.items.findOne({ where: { id: itemId } }),
      this.locations.findOne({ where: { id: supermarketLocationId } }),
    ]);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!location) {
      throw new NotFoundException('Supermarket location not found');
    }
  }
}
