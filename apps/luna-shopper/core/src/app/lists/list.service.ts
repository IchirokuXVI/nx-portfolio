import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ListRole,
  RealtimeEvent,
  ZoneRole,
  type CreateListRequest,
  type ListIdRequest,
  type ListListsRequest,
  type ListOrder,
  type ListPage,
  type ListView,
  type SetListAccessRequest,
  type UpdateListRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '@portfolio/luna-shopper/platform';
import { DataSource, Repository, type SelectQueryBuilder } from 'typeorm';
import { ListAccess, ShoppingList } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ListAccessService } from './list-access.service';
import { toListView } from './list.mappers';

interface ListCursor {
  order: ListOrder;
  value: string;
  id: string;
}

@Injectable()
export class ListService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    @InjectRepository(ListAccess)
    private readonly access: Repository<ListAccess>,
    private readonly authz: ZoneAuthzService,
    private readonly listAccess: ListAccessService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Create a list (plan 0007, section 2): any approved member of the zone. The
   * creator gets WRITER access by default, in the same transaction.
   */
  async create(req: CreateListRequest): Promise<ListView> {
    const membership = await this.authz.requireApproved(req.zoneId, req.userId);

    const list = await this.dataSource.transaction(async (manager) => {
      const list = await manager.getRepository(ShoppingList).save(
        manager.getRepository(ShoppingList).create({
          zoneId: req.zoneId,
          name: req.name,
          createdByUserId: req.userId,
        })
      );
      await manager.getRepository(ListAccess).save(
        manager.getRepository(ListAccess).create({
          listId: list.id,
          membershipId: membership.id,
          role: ListRole.WRITER,
        })
      );
      return list;
    });

    const view = toListView(list);
    this.events.emit(RealtimeEvent.ListCreated, req.zoneId, view, view.id);
    return view;
  }

  /**
   * Choose which members may read or write (plan 0007, section 2): list creator,
   * zone admin, or owner. Upserts each entry.
   */
  async setAccess(req: SetListAccessRequest): Promise<{ listId: string }> {
    const list = await this.listAccess.requireManage(req.listId, req.userId);

    await this.dataSource.transaction(async (manager) => {
      for (const entry of req.entries) {
        const existing = await manager.getRepository(ListAccess).findOne({
          where: { listId: req.listId, membershipId: entry.membershipId },
        });
        if (existing) {
          existing.role = entry.role;
          await manager.getRepository(ListAccess).save(existing);
        } else {
          await manager.getRepository(ListAccess).save(
            manager.getRepository(ListAccess).create({
              listId: req.listId,
              membershipId: entry.membershipId,
              role: entry.role,
            })
          );
        }
      }
    });

    this.events.emit(
      RealtimeEvent.ListAccessChanged,
      list.zoneId,
      {
        listId: req.listId,
      },
      req.listId
    );
    return { listId: req.listId };
  }

  /** Rename a list (plan 0007, section 2): creator, admin, or owner. */
  async update(req: UpdateListRequest): Promise<ListView> {
    const list = await this.listAccess.requireManage(req.listId, req.userId);
    if (req.name !== undefined) {
      list.name = req.name;
    }
    const view = toListView(await this.lists.save(list));
    this.events.emit(RealtimeEvent.ListUpdated, list.zoneId, view, view.id);
    return view;
  }

  /** Delete a list (plan 0007, section 2): creator, admin, or owner. */
  async delete(req: ListIdRequest): Promise<{ id: string }> {
    const list = await this.listAccess.requireManage(req.listId, req.userId);
    await this.lists.delete({ id: req.listId });
    this.events.emit(
      RealtimeEvent.ListDeleted,
      list.zoneId,
      {
        id: req.listId,
      },
      req.listId
    );
    return { id: req.listId };
  }

  /**
   * List the shopping lists in a zone the caller can see (plan 0007, section 3):
   * managers see all; other members see lists they created or were granted access
   * to. Cursor paginated and orderable by name, created, or updated.
   */
  async list(req: ListListsRequest): Promise<ListPage> {
    const membership = await this.authz.requireApproved(req.zoneId, req.userId);
    const isManager =
      membership.role === ZoneRole.OWNER || membership.role === ZoneRole.ADMIN;
    const order = this.resolveOrder(req.order);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as ListCursor | undefined;

    const qb = this.lists
      .createQueryBuilder('l')
      .where('l."zoneId" = :zoneId', { zoneId: req.zoneId })
      .take(limit + 1);

    if (!isManager) {
      // Non-managers only see lists they created or hold access to.
      qb.andWhere(
        `(l."createdByUserId" = :userId OR EXISTS (
           SELECT 1 FROM "list_access" a
           WHERE a."listId" = l.id AND a."membershipId" = :membershipId))`,
        { userId: req.userId, membershipId: membership.id }
      );
    }

    this.applyOrder(qb, order, cursor);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(toListView);
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

  private resolveOrder(order?: string): ListOrder {
    return order === 'name' || order === 'created' ? order : 'updated';
  }

  private applyOrder(
    qb: SelectQueryBuilder<ShoppingList>,
    order: ListOrder,
    cursor?: ListCursor
  ): void {
    if (order === 'name') {
      qb.orderBy('l.name', 'ASC').addOrderBy('l.id', 'ASC');
      if (cursor) {
        qb.andWhere('(l.name, l.id) > (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else if (order === 'created') {
      qb.orderBy('l.createdAt', 'DESC').addOrderBy('l.id', 'DESC');
      if (cursor) {
        qb.andWhere('(l."createdAt", l.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    } else {
      qb.orderBy('l.updatedAt', 'DESC').addOrderBy('l.id', 'DESC');
      if (cursor) {
        qb.andWhere('(l."updatedAt", l.id) < (:cv, :cid)', {
          cv: cursor.value,
          cid: cursor.id,
        });
      }
    }
  }

  private cursorValue(order: ListOrder, list: ShoppingList): string {
    if (order === 'name') {
      return list.name;
    }
    if (order === 'created') {
      return list.createdAt.toISOString();
    }
    return list.updatedAt.toISOString();
  }
}
