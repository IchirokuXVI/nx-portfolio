import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { WithholdBodyMiddleware } from '@portfolio/luna-shopper/platform';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AdminCatalogBrandsController,
  AdminCatalogBrandSuggestionsController,
  AdminCatalogCategoriesController,
  AdminCatalogItemPricesController,
  AdminCatalogItemsController,
  AdminCatalogLocationItemsController,
  AdminCatalogLocationsController,
  AdminCatalogPricePoliciesController,
  AdminCatalogPriceScopesController,
  AdminCatalogProductGroupsController,
  AdminCatalogSectionsController,
  AdminCatalogSupermarketItemsController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';
import { CatalogSuggestService } from './catalog-suggest.service';
import {
  CatalogCategoriesController,
  CatalogItemsController,
  CatalogLocationItemsController,
  CatalogLocationsController,
  CatalogLocationSectionsController,
  CatalogPriceScopesController,
  CatalogProductGroupsController,
  CatalogScopeController,
  CatalogShopsController,
  CatalogSuggestController,
  CatalogSupermarketItemsController,
  CatalogSupermarketsController,
} from './catalog.controller';
import { CatalogNearbyShopsController } from './nearby-shops.controller';
import { ScopeResolutionService } from './scope-resolution.service';
import {
  CatalogLocationMapController,
  CatalogLocationWalksController,
  CatalogWalksController,
} from './shop-walks.controller';

/**
 * The gateway's catalog surface (plan 0012), proxying to catalog over NATS.
 * Plan 0038 added price scopes and the per store rows, and moved the
 * supermarket-items controller to `v2` because its view lost two fields. Plan
 * 0048 added product groups, the ranked searches and the composer's one
 * suggestion endpoint, which is the only route here that fans out to two
 * subjects rather than proxying one. Plan 0049 made the reads that return items
 * or prices scoped, and added the one endpoint that describes the resolution
 * instead of using it. Plan 0068 added the shop reads, which are the same table
 * as the locations controller seen from the other side: browsed by a shopper,
 * keyed on where they are, rather than administered one row at a time.
 */
@Module({
  imports: [MessagingModule],
  controllers: [
    CatalogSupermarketsController,
    CatalogLocationsController,
    // Plan 0167: a shop's sections, public, so a guest reading a shared
    // basket at a shop can draw its aisles.
    CatalogLocationSectionsController,
    // Plan 0168: a shop's map, public like its sections, and its walks behind
    // `shopMap.record`.
    CatalogLocationMapController,
    CatalogLocationWalksController,
    CatalogWalksController,
    CatalogPriceScopesController,
    CatalogProductGroupsController,
    // Plan 0166: the category tree, whole, for velista's picker.
    CatalogCategoriesController,
    CatalogScopeController,
    CatalogShopsController,
    // Plan 0164: the shops near a point. A POST, so it cannot be swallowed by
    // the GET routes of the controller above.
    CatalogNearbyShopsController,
    CatalogSuggestController,
    CatalogItemsController,
    CatalogSupermarketItemsController,
    CatalogLocationItemsController,
    // Plan 0073: the same resources for an operator, one namespace over and
    // behind the other guard. They are declared in this module rather than in
    // `GatewayAdminModule` because they are catalog, and a back office route
    // added beside its user facing sibling is one somebody will remember to
    // update when the resource changes.
    AdminCatalogSupermarketsController,
    AdminCatalogLocationsController,
    AdminCatalogItemsController,
    AdminCatalogProductGroupsController,
    // Plan 0166: the tree's two levels, and the four rules catalog enforces.
    AdminCatalogCategoriesController,
    // Plan 0167: shop sections at their own id; created and listed under
    // their chain, and a shop's list under its location.
    AdminCatalogSectionsController,
    // Plan 0115: the registry a person fills, and the keys the queue is asking
    // for. The second is composed from catalog and the harvester, which is why
    // it is two controllers rather than one path with a child.
    AdminCatalogBrandsController,
    AdminCatalogBrandSuggestionsController,
    AdminCatalogSupermarketItemsController,
    // Plan 0080: the rows a source gave, and the policy that picks one.
    AdminCatalogItemPricesController,
    AdminCatalogPricePoliciesController,
    AdminCatalogPriceScopesController,
    AdminCatalogLocationItemsController,
  ],
  // Plan 0049: every read that returns items or prices resolves where the caller
  // shops first, from an explicit selector or from their profile.
  // Plan 0161: the composer's dropdown and the chains behind its prices, for
  // both suggest routes.
  providers: [ScopeResolutionService, CatalogSuggestService],
  // Exported for the basket's own search (plan 0055, section 5.1), which
  // resolves the **run's** profile rather than the caller's and must share this
  // resolver's Redis cache and its invalidation rather than growing a second
  // answer to the same question. The suggestion service goes with it, so the
  // basket and the dropdown name a scope through one helper (plan 0161).
  exports: [ScopeResolutionService, CatalogSuggestService],
})
export class GatewayCatalogModule implements NestModule {
  /**
   * The body of `POST /v1/catalog/shops/nearby` is a point a device reported,
   * and it never reaches a log line (plan 0164). A middleware, so the request
   * is marked before any guard can fail it.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(WithholdBodyMiddleware)
      .forRoutes(CatalogNearbyShopsController);
    // A walk entry is up to 256 KB of a device's positions in a shop, and a
    // log line is not the place for it (plan 0168).
    consumer.apply(WithholdBodyMiddleware).forRoutes(CatalogWalksController);
  }
}
