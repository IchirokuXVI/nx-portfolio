import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PURCHASE_PATTERNS,
  type ListRecentShopsRequest,
  type RecentShopIdsView,
} from '@portfolio/luna-shopper/contracts';
import { RecentShopsService } from './recent-shops.service';

/**
 * The caller's recent shops, over NATS (plan 0164, section 4).
 *
 * Its own controller beside the history reads, so their constructors and
 * specs stay as they are.
 */
@Controller()
export class RecentShopsController {
  constructor(private readonly shops: RecentShopsService) {}

  @MessagePattern(PURCHASE_PATTERNS.recentShops)
  recentShops(
    @Payload() req: ListRecentShopsRequest
  ): Promise<RecentShopIdsView> {
    return this.shops.recentShops(req);
  }
}
