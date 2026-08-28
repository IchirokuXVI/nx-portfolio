import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
  type AddCommentRequest,
  type AddLineRequest,
  type CommentPage,
  type CommentView,
  type CreateListRequest,
  type DeleteLineRequest,
  type LinePage,
  type LineView,
  type ListCommentsRequest,
  type ListIdRequest,
  type ListLinesRequest,
  type ListListsRequest,
  type ListPage,
  type ListView,
  type ReorderLinesRequest,
  type SetLineApprovalRequest,
  type SetLineStatusRequest,
  type SetListAccessRequest,
  type UpdateLineRequest,
  type UpdateListRequest,
} from '@portfolio/luna-shopper/contracts';
import { CommentService } from './comment.service';
import { LineService } from './line.service';
import { ListService } from './list.service';

/**
 * Core's shopping list, line and comment NATS surface (plan 0007). The gateway is
 * the only caller; authorization runs against core's own tables.
 */
@Controller()
export class ListController {
  constructor(
    private readonly lists: ListService,
    private readonly lines: LineService,
    private readonly comments: CommentService
  ) {}

  @MessagePattern(LIST_PATTERNS.create)
  createList(@Payload() req: CreateListRequest): Promise<ListView> {
    return this.lists.create(req);
  }

  @MessagePattern(LIST_PATTERNS.setAccess)
  setAccess(@Payload() req: SetListAccessRequest): Promise<{ listId: string }> {
    return this.lists.setAccess(req);
  }

  @MessagePattern(LIST_PATTERNS.update)
  updateList(@Payload() req: UpdateListRequest): Promise<ListView> {
    return this.lists.update(req);
  }

  @MessagePattern(LIST_PATTERNS.delete)
  deleteList(@Payload() req: ListIdRequest): Promise<{ id: string }> {
    return this.lists.delete(req);
  }

  @MessagePattern(LIST_PATTERNS.list)
  listLists(@Payload() req: ListListsRequest): Promise<ListPage> {
    return this.lists.list(req);
  }

  @MessagePattern(LINE_PATTERNS.add)
  addLine(@Payload() req: AddLineRequest): Promise<LineView> {
    return this.lines.add(req);
  }

  @MessagePattern(LINE_PATTERNS.update)
  updateLine(@Payload() req: UpdateLineRequest): Promise<LineView> {
    return this.lines.update(req);
  }

  @MessagePattern(LINE_PATTERNS.setApproval)
  setApproval(@Payload() req: SetLineApprovalRequest): Promise<LineView> {
    return this.lines.setApproval(req);
  }

  @MessagePattern(LINE_PATTERNS.setStatus)
  setStatus(@Payload() req: SetLineStatusRequest): Promise<LineView> {
    return this.lines.setStatus(req);
  }

  @MessagePattern(LINE_PATTERNS.reorder)
  reorder(@Payload() req: ReorderLinesRequest): Promise<{ listId: string }> {
    return this.lines.reorder(req);
  }

  @MessagePattern(LINE_PATTERNS.delete)
  deleteLine(@Payload() req: DeleteLineRequest): Promise<{ id: string }> {
    return this.lines.delete(req);
  }

  @MessagePattern(LINE_PATTERNS.list)
  listLines(@Payload() req: ListLinesRequest): Promise<LinePage> {
    return this.lines.list(req);
  }

  @MessagePattern(COMMENT_PATTERNS.add)
  addComment(@Payload() req: AddCommentRequest): Promise<CommentView> {
    return this.comments.add(req);
  }

  @MessagePattern(COMMENT_PATTERNS.list)
  listComments(@Payload() req: ListCommentsRequest): Promise<CommentPage> {
    return this.comments.list(req);
  }
}
