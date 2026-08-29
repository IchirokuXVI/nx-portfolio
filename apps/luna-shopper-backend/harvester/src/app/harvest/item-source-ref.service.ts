import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceMatch,
  ItemSourceRefStatus,
  type ItemSourceRefIdRequest,
  type ItemSourceRefPage,
  type ItemSourceRefView,
  type ListItemSourceRefsRequest,
  type SetManualItemSourceRefRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { ItemSourceRef } from '../entities';
import { toItemSourceRefView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';

interface RefCursor {
  value: string;
  id: string;
}

/**
 * The links between catalog items and a chain's products (plan 0038, section
 * 6.2), and the owner's controls over them.
 *
 * The rule the whole surface exists to serve: **a CANDIDATE never writes a
 * price.** Rung 3 of the matching ladder is a fuzzy name match, and a bad one
 * puts a wrong price on a real product that users then shop on. So a candidate
 * sits here until the owner confirms it, and `listUnresolved` is the queue they
 * work through.
 */
@Injectable()
export class ItemSourceRefService {
  constructor(
    @InjectRepository(ItemSourceRef)
    private readonly refs: Repository<ItemSourceRef>,
    private readonly admin: PlatformAdminService
  ) {}

  async list(req: ListItemSourceRefsRequest): Promise<ItemSourceRefPage> {
    this.admin.requireAdmin(req.userId);
    return this.page(req, req.status ? [req.status] : undefined);
  }

  /** The review queue: everything the ladder guessed at but did not settle. */
  async listUnresolved(
    req: ListItemSourceRefsRequest
  ): Promise<ItemSourceRefPage> {
    this.admin.requireAdmin(req.userId);
    return this.page(req, [ItemSourceRefStatus.CANDIDATE]);
  }

  /** Accept a candidate. From here on a refresh includes this item. */
  async confirm(req: ItemSourceRefIdRequest): Promise<ItemSourceRefView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.refId);
    row.status = ItemSourceRefStatus.ACTIVE;
    row.confidence = 1;
    row.lastResolvedAt = new Date();
    return toItemSourceRefView(await this.refs.save(row));
  }

  /**
   * Refuse a candidate. Kept as a REJECTED row rather than deleted, so the next
   * discovery run does not propose the same wrong match again.
   */
  async reject(req: ItemSourceRefIdRequest): Promise<ItemSourceRefView> {
    this.admin.requireAdmin(req.userId);
    const row = await this.load(req.refId);
    row.status = ItemSourceRefStatus.REJECTED;
    return toItemSourceRefView(await this.refs.save(row));
  }

  /**
   * Link an item to an external id by hand, bypassing the ladder entirely. This
   * is the escape hatch for the products no automatic rule will ever get right,
   * and a MANUAL ref is never re-derived by a later run.
   */
  async setManual(
    req: SetManualItemSourceRefRequest
  ): Promise<ItemSourceRefView> {
    this.admin.requireAdmin(req.userId);
    const existing = await this.refs.findOne({
      where: { itemId: req.itemId, supermarketId: req.supermarketId },
    });
    const row =
      existing ??
      this.refs.create({
        itemId: req.itemId,
        supermarketId: req.supermarketId,
      });
    row.externalId = req.externalId;
    row.matchedBy = ItemSourceMatch.MANUAL;
    row.status = ItemSourceRefStatus.MANUAL;
    row.confidence = 1;
    row.lastResolvedAt = new Date();
    return toItemSourceRefView(await this.refs.save(row));
  }

  private async page(
    req: ListItemSourceRefsRequest,
    statuses?: ItemSourceRefStatus[]
  ): Promise<ItemSourceRefPage> {
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as RefCursor | undefined;

    const qb = this.refs
      .createQueryBuilder('r')
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(limit + 1);
    if (req.supermarketId) {
      qb.andWhere('r."supermarketId" = :sid', { sid: req.supermarketId });
    }
    if (req.itemId) {
      qb.andWhere('r."itemId" = :iid', { iid: req.itemId });
    }
    if (statuses) {
      qb.andWhere('r.status IN (:...statuses)', { statuses });
    }
    if (cursor) {
      qb.andWhere('(r."createdAt", r.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toItemSourceRefView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async load(id: string): Promise<ItemSourceRef> {
    const row = await this.refs.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Item source reference not found');
    }
    return row;
  }
}
