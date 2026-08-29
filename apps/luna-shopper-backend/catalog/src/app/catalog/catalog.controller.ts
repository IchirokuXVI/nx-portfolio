import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type CreatePriceScopeRequest,
  type FindItemByEanRequest,
  type FindItemByEanResult,
  type GetSupermarketLocationItemRequest,
  type ListPriceScopesRequest,
  type ListSupermarketItemsByScopeRequest,
  type ListSupermarketLocationItemsRequest,
  type PriceScopeIdRequest,
  type PriceScopePage,
  type PriceScopeView,
  type SupermarketLocationItemPage,
  type SupermarketLocationItemView,
  type UpdatePriceScopeRequest,
  type UpsertSupermarketItemBatchRequest,
  type UpsertSupermarketItemBatchResult,
  type UpsertSupermarketLocationItemRequest,
  type CreateItemRequest,
  type CreateSupermarketLocationRequest,
  type CreateSupermarketRequest,
  type GetSupermarketItemRequest,
  type ItemIdRequest,
  type ItemPage,
  type ItemView,
  type ListSupermarketItemsByItemRequest,
  type ListSupermarketItemsByLocationRequest,
  type ListSupermarketLocationsRequest,
  type ListSupermarketsRequest,
  type SearchItemsRequest,
  type SupermarketIdRequest,
  type SupermarketItemIdRequest,
  type SupermarketItemPage,
  type SupermarketItemView,
  type SupermarketLocationIdRequest,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
  type UpdateItemRequest,
  type UpdateSupermarketLocationRequest,
  type UpdateSupermarketRequest,
  type UpsertSupermarketItemRequest,
} from '@portfolio/luna-shopper/contracts';
import { ItemService } from './item.service';
import { PriceScopeService } from './price-scope.service';
import { SupermarketItemService } from './supermarket-item.service';
import { SupermarketLocationItemService } from './supermarket-location-item.service';
import { SupermarketLocationService } from './supermarket-location.service';
import { SupermarketService } from './supermarket.service';

/**
 * The catalog NATS surface (plan 0012). Every subject carries the resolved
 * `userId`; the services enforce the platform-admin gate on writes and leave
 * reads open. There is no HTTP surface here (the gateway owns REST); catalog is a
 * pure NATS microservice like auth and core.
 */
@Controller()
export class CatalogController {
  constructor(
    private readonly supermarkets: SupermarketService,
    private readonly locations: SupermarketLocationService,
    private readonly items: ItemService,
    private readonly supermarketItems: SupermarketItemService,
    private readonly priceScopes: PriceScopeService,
    private readonly locationItems: SupermarketLocationItemService
  ) {}

  // --- Supermarkets --------------------------------------------------------

  @MessagePattern(SUPERMARKET_PATTERNS.create)
  createSupermarket(
    @Payload() req: CreateSupermarketRequest
  ): Promise<SupermarketView> {
    return this.supermarkets.create(req);
  }

  @MessagePattern(SUPERMARKET_PATTERNS.update)
  updateSupermarket(
    @Payload() req: UpdateSupermarketRequest
  ): Promise<SupermarketView> {
    return this.supermarkets.update(req);
  }

  @MessagePattern(SUPERMARKET_PATTERNS.delete)
  deleteSupermarket(
    @Payload() req: SupermarketIdRequest
  ): Promise<{ id: string }> {
    return this.supermarkets.delete(req);
  }

  @MessagePattern(SUPERMARKET_PATTERNS.get)
  getSupermarket(
    @Payload() req: SupermarketIdRequest
  ): Promise<SupermarketView> {
    return this.supermarkets.get(req);
  }

  @MessagePattern(SUPERMARKET_PATTERNS.list)
  listSupermarkets(
    @Payload() req: ListSupermarketsRequest
  ): Promise<SupermarketPage> {
    return this.supermarkets.list(req);
  }

  // --- Supermarket locations -----------------------------------------------

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.create)
  createLocation(
    @Payload() req: CreateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    return this.locations.create(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.update)
  updateLocation(
    @Payload() req: UpdateSupermarketLocationRequest
  ): Promise<SupermarketLocationView> {
    return this.locations.update(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.delete)
  deleteLocation(
    @Payload() req: SupermarketLocationIdRequest
  ): Promise<{ id: string }> {
    return this.locations.delete(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.get)
  getLocation(
    @Payload() req: SupermarketLocationIdRequest
  ): Promise<SupermarketLocationView> {
    return this.locations.get(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.list)
  listLocations(
    @Payload() req: ListSupermarketLocationsRequest
  ): Promise<SupermarketLocationPage> {
    return this.locations.list(req);
  }

  // --- Items ---------------------------------------------------------------

  @MessagePattern(ITEM_PATTERNS.create)
  createItem(@Payload() req: CreateItemRequest): Promise<ItemView> {
    return this.items.create(req);
  }

  @MessagePattern(ITEM_PATTERNS.update)
  updateItem(@Payload() req: UpdateItemRequest): Promise<ItemView> {
    return this.items.update(req);
  }

  @MessagePattern(ITEM_PATTERNS.delete)
  deleteItem(@Payload() req: ItemIdRequest): Promise<{ id: string }> {
    return this.items.delete(req);
  }

  @MessagePattern(ITEM_PATTERNS.get)
  getItem(@Payload() req: ItemIdRequest): Promise<ItemView> {
    return this.items.get(req);
  }

  @MessagePattern(ITEM_PATTERNS.search)
  searchItems(@Payload() req: SearchItemsRequest): Promise<ItemPage> {
    return this.items.search(req);
  }

  @MessagePattern(ITEM_PATTERNS.findByEan)
  findItemByEan(
    @Payload() req: FindItemByEanRequest
  ): Promise<FindItemByEanResult> {
    return this.items.findByEan(req);
  }

  // --- Price scopes (plan 0038) --------------------------------------------

  @MessagePattern(PRICE_SCOPE_PATTERNS.create)
  createPriceScope(
    @Payload() req: CreatePriceScopeRequest
  ): Promise<PriceScopeView> {
    return this.priceScopes.create(req);
  }

  @MessagePattern(PRICE_SCOPE_PATTERNS.update)
  updatePriceScope(
    @Payload() req: UpdatePriceScopeRequest
  ): Promise<PriceScopeView> {
    return this.priceScopes.update(req);
  }

  @MessagePattern(PRICE_SCOPE_PATTERNS.delete)
  deletePriceScope(
    @Payload() req: PriceScopeIdRequest
  ): Promise<{ id: string }> {
    return this.priceScopes.delete(req);
  }

  @MessagePattern(PRICE_SCOPE_PATTERNS.list)
  listPriceScopes(
    @Payload() req: ListPriceScopesRequest
  ): Promise<PriceScopePage> {
    return this.priceScopes.list(req);
  }

  // --- Per store rows (plan 0038, section 5.2) -----------------------------

  @MessagePattern(SUPERMARKET_LOCATION_ITEM_PATTERNS.upsert)
  upsertLocationItem(
    @Payload() req: UpsertSupermarketLocationItemRequest
  ): Promise<SupermarketLocationItemView> {
    return this.locationItems.upsert(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_ITEM_PATTERNS.get)
  getLocationItem(
    @Payload() req: GetSupermarketLocationItemRequest
  ): Promise<SupermarketLocationItemView> {
    return this.locationItems.get(req);
  }

  @MessagePattern(SUPERMARKET_LOCATION_ITEM_PATTERNS.listByLocation)
  listLocationItems(
    @Payload() req: ListSupermarketLocationItemsRequest
  ): Promise<SupermarketLocationItemPage> {
    return this.locationItems.listByLocation(req);
  }

  // --- Supermarket items (per location price/position) ---------------------

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.upsert)
  upsertSupermarketItem(
    @Payload() req: UpsertSupermarketItemRequest
  ): Promise<SupermarketItemView> {
    return this.supermarketItems.upsert(req);
  }

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.upsertBatch)
  upsertSupermarketItemBatch(
    @Payload() req: UpsertSupermarketItemBatchRequest
  ): Promise<UpsertSupermarketItemBatchResult> {
    return this.supermarketItems.upsertBatch(req);
  }

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.delete)
  deleteSupermarketItem(
    @Payload() req: SupermarketItemIdRequest
  ): Promise<{ id: string }> {
    return this.supermarketItems.delete(req);
  }

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.get)
  getSupermarketItem(
    @Payload() req: GetSupermarketItemRequest
  ): Promise<SupermarketItemView> {
    return this.supermarketItems.get(req);
  }

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.listByItem)
  listSupermarketItemsByItem(
    @Payload() req: ListSupermarketItemsByItemRequest
  ): Promise<SupermarketItemPage> {
    return this.supermarketItems.listByItem(req);
  }

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.listByLocation)
  listSupermarketItemsByLocation(
    @Payload() req: ListSupermarketItemsByLocationRequest
  ): Promise<SupermarketItemPage> {
    return this.supermarketItems.listByLocation(req);
  }

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.listByScope)
  listSupermarketItemsByScope(
    @Payload() req: ListSupermarketItemsByScopeRequest
  ): Promise<SupermarketItemPage> {
    return this.supermarketItems.listByScope(req);
  }
}
