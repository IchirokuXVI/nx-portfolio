import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  SUPERMARKET_LOCATION_PATTERNS,
  type NearbyShopsRequest,
  type NearbyShopsView,
  type ShopsByIdRequest,
  type ShopsByIdView,
} from '@portfolio/luna-shopper/contracts';
import { NearbyShopsService } from './nearby-shops.service';

/**
 * The shops near a point and the shops by id, over NATS (plan 0164).
 *
 * A controller of its own rather than two more handlers on
 * `CatalogController`, whose constructor fourteen services already fill.
 * Service to service and carrying no `userId`, like `shopAvailability`: the
 * gateway has already decided whose profile the postal codes and refusals are,
 * and a shop is not private.
 */
@Controller()
export class NearbyShopsController {
  constructor(private readonly shops: NearbyShopsService) {}

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.nearby)
  nearby(@Payload() req: NearbyShopsRequest): Promise<NearbyShopsView> {
    return this.shops.nearby(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.shopsById)
  shopsById(@Payload() req: ShopsByIdRequest): Promise<ShopsByIdView> {
    return this.shops.shopsById(req);
  }
}
