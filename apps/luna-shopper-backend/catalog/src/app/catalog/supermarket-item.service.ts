import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type GetSupermarketItemRequest,
  type ListSupermarketItemsByItemRequest,
  type ListSupermarketItemsByLocationRequest,
  type SupermarketItemIdRequest,
  type SupermarketItemPage,
  type SupermarketItemView,
  type UpsertSupermarketItemRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository } from 'typeorm';
import { Item, SupermarketItem, SupermarketLocation } from '../entities';
import { PlatformAdminService } from './platform-admin.service';
import { toSupermarketItemView } from './catalog.mappers';

/** Postgres unique-violation error code, raised on the (item, location) clash. */
const PG_UNIQUE_VIOLATION = '23505';

interface SupermarketItemCursor {
  value: string;
  id: string;
}

/**
 * The per location product rows (plan 0012): price + in store position for one
 * item at one location. Writes are owner only; reads are open. Unique on (itemId,
 * supermarketLocationId), so an upsert either creates or updates that one row.
 */
@Injectable()
export class SupermarketItemService {
  constructor(
    @InjectRepository(SupermarketItem)
    private readonly supermarketItems: Repository<SupermarketItem>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(SupermarketLocation)
    private readonly locations: Repository<SupermarketLocation>,
    private readonly admin: PlatformAdminService
  ) {}

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as { driverError?: { code?: string } }).driverError?.code ===
        PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Create or update the row for one item at one location (plan 0012). Owner only.
   * The unique (itemId, supermarketLocationId) index makes this idempotent per
   * pair; a concurrent create that loses the race surfaces as a clean conflict.
   */
  async upsert(
    req: UpsertSupermarketItemRequest
  ): Promise<SupermarketItemView> {
    this.admin.requireAdmin(req.userId);
    await this.requireItemAndLocation(req.itemId, req.supermarketLocationId);

    const existing = await this.supermarketItems.findOne({
      where: {
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      },
    });

    const row =
      existing ??
      this.supermarketItems.create({
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      });
    if (req.price !== undefined) {
      row.price = req.price;
    }
    if (req.currency !== undefined) {
      row.currency = req.currency;
    }
    if (req.positionInStore !== undefined) {
      row.positionInStore = req.positionInStore;
    }
    if (req.available !== undefined) {
      row.available = req.available;
    }

    try {
      return toSupermarketItemView(await this.supermarketItems.save(row));
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This item already has an entry for that location'
        );
      }
      throw error;
    }
  }

  async delete(req: SupermarketItemIdRequest): Promise<{ id: string }> {
    this.admin.requireAdmin(req.userId);
    const result = await this.supermarketItems.delete({
      id: req.supermarketItemId,
    });
    if (!result.affected) {
      throw new NotFoundException('Supermarket item not found');
    }
    return { id: req.supermarketItemId };
  }

  /** Read one item's row at a given location (plan 0012, section 3): open. */
  async get(req: GetSupermarketItemRequest): Promise<SupermarketItemView> {
    const row = await this.supermarketItems.findOne({
      where: {
        itemId: req.itemId,
        supermarketLocationId: req.supermarketLocationId,
      },
    });
    if (!row) {
      throw new NotFoundException(
        'No entry for that item at that location'
      );
    }
    return toSupermarketItemView(row);
  }

  async listByItem(
    req: ListSupermarketItemsByItemRequest
  ): Promise<SupermarketItemPage> {
    return this.page('itemId', req.itemId, req.cursor, req.limit);
  }

  async listByLocation(
    req: ListSupermarketItemsByLocationRequest
  ): Promise<SupermarketItemPage> {
    return this.page(
      'supermarketLocationId',
      req.supermarketLocationId,
      req.cursor,
      req.limit
    );
  }

  private async page(
    column: 'itemId' | 'supermarketLocationId',
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
