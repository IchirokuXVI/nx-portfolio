import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  SHOP_WALK_PATTERNS,
  type AppendShopWalkEntryRequest,
  type AppendShopWalkEntryResult,
  type CreateShopWalkRequest,
  type ListShopWalksRequest,
  type LocationShopMapRequest,
  type LocationShopMapView,
  type ShopWalkIdRequest,
  type ShopWalkListView,
  type ShopWalkLogRequest,
  type ShopWalkLogView,
  type ShopWalkSummaryView,
  type ShopWalkView,
  type UpdateShopWalkRequest,
} from '@portfolio/luna-shopper/contracts';
import { ShopWalkService } from './shop-walk.service';

/**
 * A shop's walks and its map over NATS (backend plan 0168). The map read
 * carries no `userId`, because a guest asks it; every other subject is reached
 * only through gateway routes behind `shopMap.record`.
 */
@Controller()
export class ShopWalksController {
  constructor(private readonly walks: ShopWalkService) {}

  @MessagePattern(SHOP_WALK_PATTERNS.mapForLocation)
  mapForLocation(
    @Payload() req: LocationShopMapRequest
  ): Promise<LocationShopMapView> {
    return this.walks.mapForLocation(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.list)
  list(@Payload() req: ListShopWalksRequest): Promise<ShopWalkListView> {
    return this.walks.list(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.create)
  create(@Payload() req: CreateShopWalkRequest): Promise<ShopWalkSummaryView> {
    return this.walks.create(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.update)
  update(@Payload() req: UpdateShopWalkRequest): Promise<ShopWalkSummaryView> {
    return this.walks.update(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.delete)
  delete(@Payload() req: ShopWalkIdRequest): Promise<{ id: string }> {
    return this.walks.delete(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.get)
  get(@Payload() req: ShopWalkIdRequest): Promise<ShopWalkView> {
    return this.walks.get(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.log)
  log(@Payload() req: ShopWalkLogRequest): Promise<ShopWalkLogView> {
    return this.walks.log(req);
  }

  @MessagePattern(SHOP_WALK_PATTERNS.append)
  append(
    @Payload() req: AppendShopWalkEntryRequest
  ): Promise<AppendShopWalkEntryResult> {
    return this.walks.append(req);
  }
}
