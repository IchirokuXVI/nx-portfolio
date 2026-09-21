import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PURCHASE_PATTERNS,
  type ListPurchaseSessionRowsRequest,
  type ListPurchaseSessionsRequest,
  type PurchaseEntryPage,
  type PurchaseRowPage,
} from '@portfolio/luna-shopper/contracts';
import { PurchasesService } from './purchases.service';

/**
 * What one person bought, over NATS (plan 0142).
 *
 * Both reads are an account's own history, so the only authorization is the
 * `userId` the gateway takes from the token. There is no list and no basket to
 * gate: the read is defined as the caller's own purchases.
 */
@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @MessagePattern(PURCHASE_PATTERNS.listSessions)
  listSessions(
    @Payload() req: ListPurchaseSessionsRequest
  ): Promise<PurchaseEntryPage> {
    return this.purchases.listSessions(req);
  }

  @MessagePattern(PURCHASE_PATTERNS.listSessionRows)
  listSessionRows(
    @Payload() req: ListPurchaseSessionRowsRequest
  ): Promise<PurchaseRowPage> {
    return this.purchases.listSessionRows(req);
  }
}
