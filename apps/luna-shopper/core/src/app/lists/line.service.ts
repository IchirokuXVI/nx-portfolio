import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LineApprovalStatus,
  LineStatus,
  RealtimeEvent,
  ZoneRole,
  type AddLineRequest,
  type DeleteLineRequest,
  type LineOrder,
  type LinePage,
  type LineView,
  type ListLinesRequest,
  type ReorderLinesRequest,
  type SetLineApprovalRequest,
  type SetLineStatusRequest,
  type UpdateLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, Repository, type SelectQueryBuilder } from 'typeorm';
import { ListLine } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ListAccessService } from './list-access.service';
import { toLineView } from './list.mappers';

interface LineCursor {
  order: LineOrder;
  value: string;
  id: string;
}

@Injectable()
export class LineService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ListLine) private readonly lines: Repository<ListLine>,
    private readonly listAccess: ListAccessService,
    private readonly zoneAuthz: ZoneAuthzService,
    private readonly events: CoreEventsPublisher
  ) {}

  private async zoneIdOf(listId: string): Promise<string> {
    return (await this.listAccess.getList(listId)).zoneId;
  }

  private emit(event: RealtimeEvent, zoneId: string, line: ListLine): void {
    this.events.emit(event, zoneId, toLineView(line), line.listId);
  }

  /** Add a line (plan 0007, section 2): writers only. Starts PENDING/PENDING. */
  async add(req: AddLineRequest): Promise<LineView> {
    const list = await this.listAccess.requireWrite(req.listId, req.userId);
    const max = await this.lines
      .createQueryBuilder('l')
      .select('COALESCE(MAX(l.position), 0)', 'max')
      .where('l."listId" = :listId', { listId: req.listId })
      .getRawOne<{ max: number }>();

    const saved = await this.lines.save(
      this.lines.create({
        listId: req.listId,
        content: req.content,
        quantity: req.quantity ?? 1,
        position: Number(max?.max ?? 0) + 1,
        approvalStatus: LineApprovalStatus.PENDING,
        status: LineStatus.PENDING,
        createdByUserId: req.userId,
        version: 1,
      })
    );
    this.emit(RealtimeEvent.LineAdded, list.zoneId, saved);
    return toLineView(saved);
  }

  /** Edit a line's text/quantity (plan 0007, section 2): writers. Bumps version. */
  async update(req: UpdateLineRequest): Promise<LineView> {
    const line = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.requireWrite(line.listId, req.userId);
    if (req.content !== undefined) {
      line.content = req.content;
    }
    if (req.quantity !== undefined) {
      line.quantity = req.quantity;
    }
    line.version += 1;
    const saved = await this.lines.save(line);
    this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
    return toLineView(saved);
  }

  /**
   * Approve or reject a line (plan 0007, section 2). The approver is a zone admin
   * or the owner; records `approvedByUserId` and bumps version.
   */
  async setApproval(req: SetLineApprovalRequest): Promise<LineView> {
    const line = await this.listAccess.getLine(req.lineId);
    const zoneId = await this.zoneIdOf(line.listId);
    await this.zoneAuthz.requireRole(zoneId, req.userId, [
      ZoneRole.OWNER,
      ZoneRole.ADMIN,
    ]);
    line.approvalStatus = req.approvalStatus;
    line.approvedByUserId =
      req.approvalStatus === LineApprovalStatus.PENDING ? null : req.userId;
    line.version += 1;
    const saved = await this.lines.save(line);
    this.emit(RealtimeEvent.LineUpdated, zoneId, saved);
    return toLineView(saved);
  }

  /** Move a line between item states (plan 0007, section 2): writers. */
  async setStatus(req: SetLineStatusRequest): Promise<LineView> {
    const line = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.requireWrite(line.listId, req.userId);
    line.status = req.status;
    line.version += 1;
    const saved = await this.lines.save(line);
    this.emit(RealtimeEvent.LineUpdated, list.zoneId, saved);
    return toLineView(saved);
  }

  /**
   * Reorder the lines of a list (plan 0007, section 2): writers. Rewrites each
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

  /** Delete a line (plan 0007, section 2): writers. */
  async delete(req: DeleteLineRequest): Promise<{ id: string }> {
    const line = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.requireWrite(line.listId, req.userId);
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
   * List a list's lines (plan 0007, section 3): requires read access. Cursor
   * paginated and orderable; default order is the manual `position`.
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
    const items = page.map(toLineView);
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
