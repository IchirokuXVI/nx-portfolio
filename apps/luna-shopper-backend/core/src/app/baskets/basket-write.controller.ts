import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BASKET_PATTERNS,
  type AddBasketLineRequest,
  type BasketRowResult,
  type BasketSearchScope,
  type BasketSearchScopeRequest,
  type BuyForListBasketRequest,
  type ChangeBasketLinesProductRequest,
  type RenameBasketRowRequest,
  type RevertBasketRowRequest,
  type SetBasketRowDemandRequest,
  type SettleBasketRowRequest,
  type SkipBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import { BasketBuyForListService } from './basket-buy-for-list.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketLineAddService } from './basket-line-add.service';
import { BasketProductChangeService } from './basket-product-change.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowRenameService } from './basket-row-rename.service';
import { BasketSettleService } from './basket-settle.service';
import { BasketSkipService } from './basket-skip.service';

/**
 * The seven writes on a row (plan 0136, section 5; plan 0137, section 5).
 *
 * A controller of its own rather than more methods on {@link BasketController},
 * because all of them share a resolver, a lock order and an event, and a
 * controller that mixed them with the reads would hide that they do.
 *
 * Every one of them carries a `participantId` the gateway's guard resolved and
 * never one the client sent, answers the same {@link BasketRowResult}, and
 * refuses a basket that is not `OPEN`.
 */
@Controller()
export class BasketWriteController {
  constructor(
    private readonly settleService: BasketSettleService,
    private readonly revertService: BasketRevertService,
    private readonly demandService: BasketDemandService,
    private readonly addService: BasketLineAddService,
    private readonly renameService: BasketRowRenameService,
    private readonly skipService: BasketSkipService,
    private readonly productChangeService: BasketProductChangeService,
    // A buy for a list that does not ask (plan 0273). Last, so no positional
    // construction has to shift an argument.
    private readonly buyForListService: BasketBuyForListService
  ) {}

  @MessagePattern(BASKET_PATTERNS.rowSettle)
  settle(@Payload() req: SettleBasketRowRequest): Promise<BasketRowResult> {
    return this.settleService.settle(req);
  }

  /** A buy for a list that does not ask, with its line at zero (plan 0273). */
  @MessagePattern(BASKET_PATTERNS.rowBuyForList)
  buyForList(
    @Payload() req: BuyForListBasketRequest
  ): Promise<BasketRowResult> {
    return this.buyForListService.buyForList(req);
  }

  @MessagePattern(BASKET_PATTERNS.rowRevert)
  revert(@Payload() req: RevertBasketRowRequest): Promise<BasketRowResult> {
    return this.revertService.revert(req);
  }

  @MessagePattern(BASKET_PATTERNS.rowDemand)
  demand(@Payload() req: SetBasketRowDemandRequest): Promise<BasketRowResult> {
    return this.demandService.setDemand(req);
  }

  @MessagePattern(BASKET_PATTERNS.rowRename)
  rename(@Payload() req: RenameBasketRowRequest): Promise<BasketRowResult> {
    return this.renameService.rename(req);
  }

  /** Put a row off for now, and take that back (plan 0137). */
  @MessagePattern(BASKET_PATTERNS.rowSkip)
  skip(@Payload() req: SkipBasketRowRequest): Promise<BasketRowResult> {
    return this.skipService.skip(req);
  }

  @MessagePattern(BASKET_PATTERNS.rowUnskip)
  unskip(@Payload() req: SkipBasketRowRequest): Promise<BasketRowResult> {
    return this.skipService.unskip(req);
  }

  @MessagePattern(BASKET_PATTERNS.lineAdd)
  add(@Payload() req: AddBasketLineRequest): Promise<BasketRowResult> {
    return this.addService.add(req);
  }

  /** Change the product of basket lines (plan 0202, section 3). */
  @MessagePattern(BASKET_PATTERNS.linesProduct)
  linesProduct(
    @Payload() req: ChangeBasketLinesProductRequest
  ): Promise<BasketRowResult> {
    return this.productChangeService.change(req);
  }

  /** Where a search inside this basket is priced (section 5.4). */
  @MessagePattern(BASKET_PATTERNS.searchScope)
  searchScope(
    @Payload() req: BasketSearchScopeRequest
  ): Promise<BasketSearchScope> {
    return this.addService.searchScope(req);
  }
}
