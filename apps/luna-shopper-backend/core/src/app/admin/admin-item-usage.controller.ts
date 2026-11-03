import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ADMIN_ITEM_PATTERNS,
  type AdminItemUsageRequest,
  type AdminItemUsageResult,
} from '@portfolio/luna-shopper/contracts';
import { AdminItemUsageService } from './admin-item-usage.service';

/**
 * What core holds that names a catalog product, for catalog's delete (plan
 * 0239, section 4). Gated on an operator token inside the service, like every
 * handler of `CoreAdminController`, and a controller of its own so that one's
 * constructor does not move.
 */
@Controller()
export class AdminItemUsageController {
  constructor(private readonly usage: AdminItemUsageService) {}

  @MessagePattern(ADMIN_ITEM_PATTERNS.usage)
  itemUsage(
    @Payload() req: AdminItemUsageRequest
  ): Promise<AdminItemUsageResult> {
    return this.usage.usage(req);
  }
}
