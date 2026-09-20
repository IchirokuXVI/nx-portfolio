import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  GENERATED_LIST_PATTERNS,
  type CreateGeneratedListRequest,
  type GeneratedListIdRequest,
  type GeneratedListPage,
  type GeneratedListRunResult,
  type GeneratedListView,
  type ListGeneratedListsRequest,
  type ListSharedGeneratedListsRequest,
  type SharedGeneratedListCorePage,
  type UpdateGeneratedListRequest,
} from '@portfolio/luna-shopper/contracts';
import { GeneratedListService } from './generated-list.service';

/**
 * Core's generated shopping list NATS surface (plan 0050). The gateway is the
 * only caller and every request carries the `userId` a verified token resolved
 * to; ownership is enforced inside the services, which answer "not found" for
 * somebody else's basket rather than "forbidden" (section 8).
 */
@Controller()
export class GeneratedListController {
  constructor(private readonly lists: GeneratedListService) {}

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

  /** The baskets other people shared with the caller (plan 0114, section 8). */
  @MessagePattern(GENERATED_LIST_PATTERNS.listShared)
  listShared(
    @Payload() req: ListSharedGeneratedListsRequest
  ): Promise<SharedGeneratedListCorePage> {
    return this.lists.listShared(req);
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

}
