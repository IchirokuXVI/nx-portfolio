import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ListPermission,
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
  ForbiddenException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { LineComment } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
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
    private readonly events: CoreEventsPublisher
  ) {}

  /**
   * Add a comment (plan 0007, section 2; plan 0036, section 4). `WRITE` or
   * `DECIDE`.
   *
   * It used to ask only for an approved zone membership, which was wrong at both
   * ends (plan 0036, section 1.4): a caller with no access to the list at all
   * could comment on its lines, and a caller who could see the list and nothing
   * else could too. Read should mean read, comments included, and commenting
   * should follow access to the list.
   *
   * Either of the two, because both describe somebody who takes part: the person
   * who puts things on the list and the person who decides what goes in the
   * trolley both have things to say about a line. `MANAGE` implies both in every
   * grant this service writes, so it needs no third branch.
   */
  async add(req: AddCommentRequest): Promise<CommentView> {
    const line = await this.listAccess.getLine(req.lineId);
    const { list, permissions } = await this.listAccess.resolve(
      line.listId,
      req.userId
    );
    if (
      !permissions.has(ListPermission.WRITE) &&
      !permissions.has(ListPermission.DECIDE)
    ) {
      throw new ForbiddenException(
        'You can read this list but not write to it, comments included'
      );
    }

    const saved = await this.comments.save(
      this.comments.create({
        lineId: req.lineId,
        authorUserId: req.userId,
        body: req.body,
      })
    );
    const view = toCommentView(saved);
    this.events.emit(RealtimeEvent.CommentAdded, list.zoneId, view, list.id);
    return view;
  }

  /**
   * List a line's comments (plan 0007, section 3). `READ`, which is genuinely
   * everything on a list a caller may see. Fixed newest-to-oldest order (no
   * caller-chosen ordering), cursor paginated.
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
