import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CATALOG_EVENTS,
  SOURCE_ENTRY_PATTERNS,
  type ItemMergedEvent,
  type SourceEntryItemUsageRequest,
  type SourceEntryItemUsageResult,
} from '@portfolio/luna-shopper/contracts';
import { ItemMergeService } from './item-merge.service';

/**
 * The harvester's surface for a product merge (plan 0239).
 *
 * A controller of its own beside `HarvestController`, so that one's
 * constructor, which the specs build positionally, does not move.
 */
@Controller()
export class ItemMergeController {
  constructor(private readonly merges: ItemMergeService) {}

  /** What names these products here: catalog asks before a merge or a delete. */
  @MessagePattern(SOURCE_ENTRY_PATTERNS.itemUsage)
  itemUsage(
    @Payload() req: SourceEntryItemUsageRequest
  ): Promise<SourceEntryItemUsageResult> {
    return this.merges.usage(req);
  }

  /**
   * Catalog merged a product: its rows move to the survivor. An event, fire
   * and forget, answered by nobody. The harvester's NATS connection is bound
   * to a queue group, so at two replicas this runs once.
   */
  @EventPattern(CATALOG_EVENTS.itemMerged)
  itemMerged(@Payload() event: ItemMergedEvent): Promise<void> {
    return this.merges.onItemMerged(event);
  }
}
