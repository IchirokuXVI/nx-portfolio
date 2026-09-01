import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
  type AddCommentRequest,
  type AddLineQuantityRequest,
  type AddLineRequest,
  type AddLinesRequest,
  type AddVoiceCommentRequest,
  type CommentAudioView,
  type CommentPage,
  type CommentView,
  type CreateListRequest,
  type DeleteLineRequest,
  type GetCommentAudioRequest,
  type GetListAccessRequest,
  type LinePage,
  type LineSettlementPage,
  type LineSettlementResult,
  type LineView,
  type ListAccessView,
  type ListCommentsRequest,
  type ListIdRequest,
  type ListItemSettlementsRequest,
  type ListLineSettlementsRequest,
  type ListLinesRequest,
  type ListListsRequest,
  type ListPage,
  type ListsHoldingItemRequest,
  type ListsHoldingItemResult,
  type ListView,
  type ReorderLinesRequest,
  type SetCommentTranscriptionRequest,
  type SetLineApprovalRequest,
  type SetListAccessRequest,
  type SettleLineRequest,
  type UpdateLineRequest,
  type UpdateListRequest,
} from '@portfolio/luna-shopper/contracts';
import { CommentService } from './comment.service';
import { LineService } from './line.service';
import { ListService } from './list.service';
import { SettlementService } from './settlement.service';

/**
 * Core's shopping list, line and comment NATS surface (plan 0007). The gateway is
 * the only caller; authorization runs against core's own tables.
 */
@Controller()
export class ListController {
  constructor(
    private readonly lists: ListService,
    private readonly lines: LineService,
    private readonly comments: CommentService,
    private readonly history: SettlementService
  ) {}

  @MessagePattern(LIST_PATTERNS.create)
  createList(@Payload() req: CreateListRequest): Promise<ListView> {
    return this.lists.create(req);
  }

  @MessagePattern(LIST_PATTERNS.setAccess)
  setAccess(@Payload() req: SetListAccessRequest): Promise<{ listId: string }> {
    return this.lists.setAccess(req);
  }

  @MessagePattern(LIST_PATTERNS.getAccess)
  getAccess(@Payload() req: GetListAccessRequest): Promise<ListAccessView> {
    return this.lists.getAccess(req);
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

  @MessagePattern(LIST_PATTERNS.holdingItem)
  holdingItem(
    @Payload() req: ListsHoldingItemRequest
  ): Promise<ListsHoldingItemResult> {
    return this.lists.holdingItem(req);
  }

  @MessagePattern(LINE_PATTERNS.add)
  addLine(@Payload() req: AddLineRequest): Promise<LineView> {
    return this.lines.add(req);
  }

  @MessagePattern(LINE_PATTERNS.addMany)
  addLines(@Payload() req: AddLinesRequest): Promise<LineView[]> {
    return this.lines.addMany(req);
  }

  @MessagePattern(LINE_PATTERNS.update)
  updateLine(@Payload() req: UpdateLineRequest): Promise<LineView> {
    return this.lines.update(req);
  }

  @MessagePattern(LINE_PATTERNS.addQuantity)
  addLineQuantity(@Payload() req: AddLineQuantityRequest): Promise<LineView> {
    return this.lines.addQuantity(req);
  }

  @MessagePattern(LINE_PATTERNS.setApproval)
  setApproval(@Payload() req: SetLineApprovalRequest): Promise<LineView> {
    return this.lines.setApproval(req);
  }

  @MessagePattern(LINE_PATTERNS.settle)
  settle(@Payload() req: SettleLineRequest): Promise<LineSettlementResult> {
    return this.history.settle(req);
  }

  @MessagePattern(LINE_PATTERNS.settlements)
  lineSettlements(
    @Payload() req: ListLineSettlementsRequest
  ): Promise<LineSettlementPage> {
    return this.history.listForLine(req);
  }

  @MessagePattern(LINE_PATTERNS.itemSettlements)
  itemSettlements(
    @Payload() req: ListItemSettlementsRequest
  ): Promise<LineSettlementPage> {
    return this.history.listForItem(req);
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

  @MessagePattern(COMMENT_PATTERNS.addVoice)
  addVoiceComment(
    @Payload() req: AddVoiceCommentRequest
  ): Promise<CommentView> {
    return this.comments.addVoice(req);
  }

  @MessagePattern(COMMENT_PATTERNS.getAudio)
  getCommentAudio(
    @Payload() req: GetCommentAudioRequest
  ): Promise<CommentAudioView> {
    return this.comments.getAudio(req);
  }

  @MessagePattern(COMMENT_PATTERNS.setTranscription)
  setCommentTranscription(
    @Payload() req: SetCommentTranscriptionRequest
  ): Promise<CommentView> {
    return this.comments.setTranscription(req);
  }
}
