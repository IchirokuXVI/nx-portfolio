import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  CATALOG_EVENTS,
  type ItemGroupChangedEvent,
  type ProductGroupDeletedEvent,
} from '@portfolio/luna-shopper/contracts';
import { ProductGroupSyncService } from './product-group-sync.service';

/**
 * Core's subscriber for catalog's product group events (plan 0070, section 5.1).
 *
 * A controller of its own, beside {@link ListController} rather than inside it,
 * for the reason `AccountController` is one: these are **events**, not the REST
 * shaped request/reply surface the gateway calls, and they answer nobody. Both
 * handlers are idempotent through the `processed_events` inbox, so an at least
 * once redelivery is harmless.
 */
@Controller()
export class ProductGroupSyncController {
  constructor(private readonly sync: ProductGroupSyncService) {}

  @EventPattern(CATALOG_EVENTS.itemGroupChanged)
  async onItemGroupChanged(
    @Payload() event: ItemGroupChangedEvent
  ): Promise<void> {
    await this.sync.handleItemGroupChanged(event);
  }

  @EventPattern(CATALOG_EVENTS.productGroupDeleted)
  async onProductGroupDeleted(
    @Payload() event: ProductGroupDeletedEvent
  ): Promise<void> {
    await this.sync.handleProductGroupDeleted(event);
  }
}
