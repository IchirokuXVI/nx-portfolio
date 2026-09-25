import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BASKET_PATTERNS,
  type CreateBasketRequest,
  type BasketIdRequest,
  type BasketPage,
  type BasketRunResult,
  type BasketHeaderView,
  type ListBasketsRequest,
  type ListSharedBasketsRequest,
  type SharedBasketCorePage,
  type UpdateBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import { BasketService } from './basket.service';

/**
 * Core's generated shopping list NATS surface (plan 0050). The gateway is the
 * only caller and every request carries the `userId` a verified token resolved
 * to; ownership is enforced inside the services, which answer "not found" for
 * somebody else's basket rather than "forbidden" (section 8).
 */
@Controller()
export class BasketController {
  constructor(private readonly lists: BasketService) {}

  @MessagePattern(BASKET_PATTERNS.create)
  create(
    @Payload() req: CreateBasketRequest
  ): Promise<BasketRunResult> {
    return this.lists.create(req);
  }

  @MessagePattern(BASKET_PATTERNS.listMine)
  listMine(
    @Payload() req: ListBasketsRequest
  ): Promise<BasketPage> {
    return this.lists.listMine(req);
  }

  /** The baskets other people shared with the caller (plan 0114, section 8). */
  @MessagePattern(BASKET_PATTERNS.listShared)
  listShared(
    @Payload() req: ListSharedBasketsRequest
  ): Promise<SharedBasketCorePage> {
    return this.lists.listShared(req);
  }

  @MessagePattern(BASKET_PATTERNS.get)
  get(@Payload() req: BasketIdRequest): Promise<BasketHeaderView> {
    return this.lists.get(req);
  }

  @MessagePattern(BASKET_PATTERNS.update)
  update(
    @Payload() req: UpdateBasketRequest
  ): Promise<BasketHeaderView> {
    return this.lists.update(req);
  }

  @MessagePattern(BASKET_PATTERNS.delete)
  delete(@Payload() req: BasketIdRequest): Promise<{ id: string }> {
    return this.lists.delete(req);
  }

}
