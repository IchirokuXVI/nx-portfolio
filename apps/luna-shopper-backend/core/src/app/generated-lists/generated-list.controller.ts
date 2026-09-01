import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GENERATED_LIST_PATTERNS,
  type AddGeneratedListLineRequest,
  type CreateGeneratedListRequest,
  type GeneratedListIdRequest,
  type GeneratedListLineIdRequest,
  type GeneratedListLineView,
  type GeneratedListPage,
  type GeneratedListRunResult,
  type GeneratedListView,
  type ListGeneratedListsRequest,
  type ReorderGeneratedListLinesRequest,
  type UpdateGeneratedListLineRequest,
  type UpdateGeneratedListRequest,
} from '@portfolio/luna-shopper/contracts';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListService } from './generated-list.service';

/**
 * Core's generated shopping list NATS surface (plan 0050). The gateway is the
 * only caller and every request carries the `userId` a verified token resolved
 * to; ownership is enforced inside the services, which answer "not found" for
 * somebody else's basket rather than "forbidden" (section 8).
 */
@Controller()
export class GeneratedListController {
  constructor(
    private readonly lists: GeneratedListService,
    private readonly lines: GeneratedListLineService
  ) {}

  @MessagePattern(GENERATED_LIST_PATTERNS.create)
  create(
    @Payload() req: CreateGeneratedListRequest
  ): Promise<GeneratedListRunResult> {
    return this.lists.create(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.listMine)
  listMine(
    @Payload() req: ListGeneratedListsRequest
  ): Promise<GeneratedListPage> {
    return this.lists.listMine(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.get)
  get(@Payload() req: GeneratedListIdRequest): Promise<GeneratedListView> {
    return this.lists.get(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.update)
  update(
    @Payload() req: UpdateGeneratedListRequest
  ): Promise<GeneratedListView> {
    return this.lists.update(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.delete)
  delete(@Payload() req: GeneratedListIdRequest): Promise<{ id: string }> {
    return this.lists.delete(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.addLine)
  addLine(
    @Payload() req: AddGeneratedListLineRequest
  ): Promise<GeneratedListLineView> {
    return this.lines.addLine(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.updateLine)
  updateLine(
    @Payload() req: UpdateGeneratedListLineRequest
  ): Promise<GeneratedListLineView> {
    return this.lines.updateLine(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.deleteLine)
  deleteLine(
    @Payload() req: GeneratedListLineIdRequest
  ): Promise<{ id: string }> {
    return this.lines.deleteLine(req);
  }

  @MessagePattern(GENERATED_LIST_PATTERNS.reorderLines)
  reorderLines(
    @Payload() req: ReorderGeneratedListLinesRequest
  ): Promise<GeneratedListView> {
    return this.lines.reorderLines(req);
  }
}
