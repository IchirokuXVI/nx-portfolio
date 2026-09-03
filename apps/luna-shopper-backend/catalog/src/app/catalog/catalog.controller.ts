import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  POSTAL_CODE_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PRODUCT_GROUP_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type CountLocationsByPostalCodeRequest,
  type CreateItemRequest,
  type AdminListSupermarketItemsRequest,
  type CreatePriceScopeRequest,
  type CreateProductGroupRequest,
  type CreateSupermarketLocationRequest,
  type CreateSupermarketRequest,
  type FindItemByEanRequest,
  type FindItemByEanResult,
  type GetItemsRequest,
  type GetItemsResult,
  type GetSupermarketItemRequest,
  type GetSupermarketLocationItemRequest,
  type ItemIdRequest,
  type ItemPage,
  type ItemView,
  type ListNearbyPostalCodesRequest,
  type ListPriceScopesRequest,
  type ListProductGroupsRequest,
  type ListSupermarketItemsByItemRequest,
  type ListSupermarketItemsByLocationRequest,
  type ListSupermarketItemsByScopeRequest,
  type ListSupermarketLocationItemsRequest,
  type ListSupermarketLocationsRequest,
  type ListSupermarketsRequest,
  type NearbyPostalCodesView,
  type NearestPostalCodeView,
  type PostalCodeLocationCountsView,
  type PriceScopeIdRequest,
  type PriceScopePage,
  type PriceScopeView,
  type ProductGroupIdRequest,
  type ProductGroupOfferPage,
  type ProductGroupPage,
  type ProductGroupView,
  type ResolvedScopesView,
  type ResolveNearestPostalCodeRequest,
  type ResolvePriceScopesRequest,
  type SearchItemsRequest,
  type SearchOffersRequest,
  type SearchShopsRequest,
  type ShopPage,
  type SummarizeLocationsByChainRequest,
  type SupermarketIdRequest,
  type SupermarketItemIdRequest,
  type SupermarketItemPage,
  type SupermarketItemView,
  type SupermarketLocationChainSummariesView,
  type SupermarketLocationIdRequest,
  type SupermarketLocationItemPage,
  type SupermarketLocationItemView,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
  type UpdateItemRequest,
  type UpdatePriceScopeRequest,
  type UpdateProductGroupRequest,
  type UpdateSupermarketLocationRequest,
  type UpdateSupermarketRequest,
  type UpsertSupermarketItemBatchRequest,
  type UpsertSupermarketItemBatchResult,
  type UpsertSupermarketItemRequest,
  type UpsertSupermarketLocationItemRequest,
} from '@portfolio/luna-shopper/contracts';
import { ItemService } from './item.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';
import { ScopeResolverService } from './scope-resolver.service';
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
    private readonly locationItems: SupermarketLocationItemService,
    private readonly productGroups: ProductGroupService,
    private readonly scopeResolver: ScopeResolverService,
    private readonly postalCodes: PostalCodeService
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

  /**
   * How many shops we hold in each of these postal codes (plan 0063, section 5).
   *
   * Service to service and carrying no `userId`, like the two postal code reads
   * above it: the harvester asks it to decide which announced codes are unknown,
   * and it counts rows over a table catalog already serves openly.
   */
  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.countByPostalCode)
  countLocationsByPostalCode(
    @Payload() req: CountLocationsByPostalCodeRequest
  ): Promise<PostalCodeLocationCountsView> {
    return this.locations.countByPostalCode(req);
  }

  /**
   * The chains with a shop in the caller's postal codes, and how many they have
   * (plan 0068, section 3.1).
   *
   * The refusals arrive as ids because the gateway resolved them from core:
   * catalog knows which shop belongs to which chain and nothing else, which is
   * exactly the split every priced read has kept since plan 0049.
   */
  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.summarizeByChain)
  summarizeLocationsByChain(
    @Payload() req: SummarizeLocationsByChainRequest
  ): Promise<SupermarketLocationChainSummariesView> {
    return this.locations.summarizeByChain(req);
  }

  /** The shops themselves, in those codes (plan 0068, section 3.2). */
  @MessagePattern(SUPERMARKET_LOCATION_PATTERNS.search)
  searchShops(@Payload() req: SearchShopsRequest): Promise<ShopPage> {
    return this.locations.search(req);
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

  /**
   * Several products by id, for the basket screen (plan 0051, section 6.1).
   *
   * The one catalog read that carries no `userId`, because a product's name is
   * not private and a **guest** holding a shared basket has to be able to read
   * the name of the thing they are being asked to buy.
   */
  @MessagePattern(ITEM_PATTERNS.getMany)
  getItems(@Payload() req: GetItemsRequest): Promise<GetItemsResult> {
    return this.items.getMany(req);
  }

  @MessagePattern(ITEM_PATTERNS.search)
  searchItems(@Payload() req: SearchItemsRequest): Promise<ItemPage> {
    return this.items.search(req);
  }

  /**
   * Ranked groups with their cheapest member (plan 0048, section 3). The read the
   * list composer runs for a bare word, and the one that enforces "a group beats
   * an item" by existing at all.
   */
  @MessagePattern(ITEM_PATTERNS.searchOffers)
  searchOffers(
    @Payload() req: SearchOffersRequest
  ): Promise<ProductGroupOfferPage> {
    return this.items.searchOffers(req);
  }

  @MessagePattern(ITEM_PATTERNS.findByEan)
  findItemByEan(
    @Payload() req: FindItemByEanRequest
  ): Promise<FindItemByEanResult> {
    return this.items.findByEan(req);
  }

  // --- Product groups (plan 0048, section 1) -------------------------------

  @MessagePattern(PRODUCT_GROUP_PATTERNS.create)
  createProductGroup(
    @Payload() req: CreateProductGroupRequest
  ): Promise<ProductGroupView> {
    return this.productGroups.create(req);
  }

  @MessagePattern(PRODUCT_GROUP_PATTERNS.update)
  updateProductGroup(
    @Payload() req: UpdateProductGroupRequest
  ): Promise<ProductGroupView> {
    return this.productGroups.update(req);
  }

  @MessagePattern(PRODUCT_GROUP_PATTERNS.delete)
  deleteProductGroup(
    @Payload() req: ProductGroupIdRequest
  ): Promise<{ id: string }> {
    return this.productGroups.delete(req);
  }

  @MessagePattern(PRODUCT_GROUP_PATTERNS.get)
  getProductGroup(
    @Payload() req: ProductGroupIdRequest
  ): Promise<ProductGroupView> {
    return this.productGroups.get(req);
  }

  @MessagePattern(PRODUCT_GROUP_PATTERNS.list)
  listProductGroups(
    @Payload() req: ListProductGroupsRequest
  ): Promise<ProductGroupPage> {
    return this.productGroups.list(req);
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

  /**
   * What a place resolves to today (plan 0049, sections 1.1 and 3.1). The
   * gateway's second call before a scoped catalog read: core says what the user
   * typed, this says what it means.
   */
  @MessagePattern(PRICE_SCOPE_PATTERNS.resolve)
  resolvePriceScopes(
    @Payload() req: ResolvePriceScopesRequest
  ): Promise<ResolvedScopesView> {
    return this.scopeResolver.resolve(req);
  }

  // --- Postal code geography (plan 0060, section 5) ------------------------
  //
  // Internal reads over the shipped centroids, with no `userId` and no gateway
  // route: core asks them (plans 0058 and 0062), nothing user facing does.

  /** Which postal code a point is in, or null when no centroid is close enough. */
  @MessagePattern(POSTAL_CODE_PATTERNS.nearest)
  nearestPostalCode(
    @Payload() req: ResolveNearestPostalCodeRequest
  ): Promise<NearestPostalCodeView> {
    return this.postalCodes.nearest(req);
  }

  /** Which postal codes sit within a radius of one, centroid to centroid. */
  @MessagePattern(POSTAL_CODE_PATTERNS.nearby)
  nearbyPostalCodes(
    @Payload() req: ListNearbyPostalCodesRequest
  ): Promise<NearbyPostalCodesView> {
    return this.postalCodes.nearby(req);
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

  @MessagePattern(SUPERMARKET_ITEM_PATTERNS.adminList)
  adminListSupermarketItems(
    @Payload() req: AdminListSupermarketItemsRequest
  ): Promise<SupermarketItemPage> {
    return this.supermarketItems.adminList(req);
  }
}
