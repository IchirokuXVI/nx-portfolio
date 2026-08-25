import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  RealtimeEvent,
  type AddCommentRequest,
  type CommentPage,
  type CommentView,
  type ListCommentsRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { LineComment } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ListAccessService } from './list-access.service';
import { toCommentView } from './list.mappers';

interface CommentCursor {
  value: string;
  id: string;
}

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(LineComment)
    private readonly comments: Repository<LineComment>,
    private readonly listAccess: ListAccessService,
    private readonly zoneAuthz: ZoneAuthzService,
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Add a comment (plan 0007, section 2): any approved member of the zone may
   * comment on a line.
   */
  async add(req: AddCommentRequest): Promise<CommentView> {
    const line = await this.listAccess.getLine(req.lineId);
    const list = await this.listAccess.getList(line.listId);
    await this.zoneAuthz.requireApproved(list.zoneId, req.userId);

    const saved = await this.comments.save(
      this.comments.create({
        lineId: req.lineId,
        authorUserId: req.userId,
        body: req.body,
      })
    );
    const view = toCommentView(saved);
    this.events.emit(RealtimeEvent.CommentAdded, list.zoneId, view);
    return view;
  }

  /**
   * List a line's comments (plan 0007, section 3): requires read access to the
   * list. Fixed newest-to-oldest order (no caller-chosen ordering), cursor
   * paginated.
   */
  async list(req: ListCommentsRequest): Promise<CommentPage> {
    const line = await this.listAccess.getLine(req.lineId);
    await this.listAccess.requireRead(line.listId, req.userId);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as CommentCursor | undefined;

    const qb = this.comments
      .createQueryBuilder('c')
      .where('c."lineId" = :lineId', { lineId: req.lineId })
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(limit + 1);

    if (cursor) {
      qb.andWhere('(c."createdAt", c.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(toCommentView);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  }
}
