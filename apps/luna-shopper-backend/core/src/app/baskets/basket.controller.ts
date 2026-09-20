import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BASKET_PATTERNS,
  type BasketSummaryView,
  type BasketView,
  type GetBasketRequest,
  type GetLiveBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import { BasketLiveService } from './basket-live.service';
import { BasketReadService } from './basket-read.service';

/**
 * Core's basket surface (plan 0136).
 *
 * The reads alone. Every write on a row is on {@link BasketWriteController},
 * because the five of them share a resolver, a lock order and an event, and a
 * controller that mixed them with the reads would hide that they do.
 *
 * `basket.get` carries a participant and no `userId`: the gateway's guard has
 * already turned a credential into a participant, and the participant is the
 * whole of the identity here. An owner reading their own basket arrives as their
 * own participant row like everybody else, which is what lets one screen serve
 * all three readers.
 *
 * `basket.live` is the exception and carries a `userId` instead, because there
 * is no participant until the basket exists and no basket until somebody asks.
 */
@Controller()
export class BasketController {
  constructor(
    private readonly read: BasketReadService,
    private readonly live: BasketLiveService
  ) {}

  @MessagePattern(BASKET_PATTERNS.get)
  get(@Payload() req: GetBasketRequest): Promise<BasketView> {
    return this.read.read(req);
  }

  @MessagePattern(BASKET_PATTERNS.live)
  getLive(@Payload() req: GetLiveBasketRequest): Promise<BasketView> {
    return this.live.live(req);
  }

  @MessagePattern(BASKET_PATTERNS.liveSummary)
  getLiveSummary(
    @Payload() req: GetLiveBasketRequest
  ): Promise<BasketSummaryView> {
    return this.live.summary(req);
  }
}
