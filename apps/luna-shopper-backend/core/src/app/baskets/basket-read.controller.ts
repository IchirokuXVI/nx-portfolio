import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BASKET_PATTERNS,
  type AcknowledgeBasketChangesRequest,
  type BasketChangePage,
  type BasketChangesAcknowledged,
  type BasketMarksView,
  type BasketPriceChoicesView,
  type BasketProductListsView,
  type BasketSummaryView,
  type BasketView,
  type GetBasketMarksRequest,
  type GetBasketPriceChoicesRequest,
  type GetBasketProductListsRequest,
  type GetBasketRequest,
  type GetLiveBasketRequest,
  type ListBasketChangesRequest,
} from '@portfolio/luna-shopper/contracts';
import { BasketLiveService } from './basket-live.service';
import { BasketProductService } from './basket-product.service';
import { BasketReadService } from './basket-read.service';
import { BasketChangesService } from './changes/basket-changes.service';

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
export class BasketReadController {
  constructor(
    private readonly read: BasketReadService,
    private readonly live: BasketLiveService,
    private readonly changes: BasketChangesService,
    private readonly products: BasketProductService
  ) {}

  /**
   * The covered lines whose product needs a price (plan 0201, section 1).
   *
   * The gateway asks it before the read, prices the answer, and sends the
   * picks on `basket.get`. A basket with no such line answers an empty list
   * and the read costs no catalog round trip for it.
   */
  @MessagePattern(BASKET_PATTERNS.priceChoices)
  priceChoices(
    @Payload() req: GetBasketPriceChoicesRequest
  ): Promise<BasketPriceChoicesView> {
    return this.products.priceChoices(req);
  }

  /** The same for the permanent basket, which is asked for by account. */
  @MessagePattern(BASKET_PATTERNS.livePriceChoices)
  livePriceChoices(
    @Payload() req: GetLiveBasketRequest
  ): Promise<BasketPriceChoicesView> {
    return this.products.livePriceChoices(req);
  }

  /** The covered lists that can still take a product (plan 0201, section 5). */
  @MessagePattern(BASKET_PATTERNS.productLists)
  productLists(
    @Payload() req: GetBasketProductListsRequest
  ): Promise<BasketProductListsView> {
    return this.products.productLists(req);
  }

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

  /**
   * What changed on the covered lists, newest first (plan 0138, section 8).
   *
   * A read rather than a write, so it lives here beside the basket's own: what it
   * answers is a history of the lists, drawn for one viewer.
   */
  @MessagePattern(BASKET_PATTERNS.changesList)
  listChanges(
    @Payload() req: ListBasketChangesRequest
  ): Promise<BasketChangePage> {
    return this.changes.list(req);
  }

  /** The marks and the count alone, with no rows (plan 0204, section 6). */
  @MessagePattern(BASKET_PATTERNS.changesMarks)
  marks(@Payload() req: GetBasketMarksRequest): Promise<BasketMarksView> {
    return this.changes.marksOf(req);
  }

  /**
   * Say which changes this viewer has drawn (section 6).
   *
   * Here and not on {@link BasketWriteController} although it writes a row: what
   * it moves is one viewer's own cursor, not the basket, and it answers a count
   * rather than a row. Every write over there answers `BasketRowResult`.
   */
  @MessagePattern(BASKET_PATTERNS.changesAcknowledge)
  acknowledgeChanges(
    @Payload() req: AcknowledgeBasketChangesRequest
  ): Promise<BasketChangesAcknowledged> {
    return this.changes.acknowledge(req);
  }
}
