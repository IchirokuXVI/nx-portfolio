import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AdminCatalogItemsController,
  AdminCatalogLocationItemsController,
  AdminCatalogLocationsController,
  AdminCatalogPriceScopesController,
  AdminCatalogProductGroupsController,
  AdminCatalogSupermarketItemsController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';
import {
  CatalogItemsController,
  CatalogLocationItemsController,
  CatalogLocationsController,
  CatalogPriceScopesController,
  CatalogProductGroupsController,
  CatalogScopeController,
  CatalogShopsController,
  CatalogSuggestController,
  CatalogSupermarketItemsController,
  CatalogSupermarketsController,
} from './catalog.controller';
import { ScopeResolutionService } from './scope-resolution.service';

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
    CatalogPriceScopesController,
    CatalogProductGroupsController,
    CatalogScopeController,
    CatalogShopsController,
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
    AdminCatalogSupermarketItemsController,
    AdminCatalogPriceScopesController,
    AdminCatalogLocationItemsController,
  ],
  // Plan 0049: every read that returns items or prices resolves where the caller
  // shops first, from an explicit selector or from their profile.
  providers: [ScopeResolutionService],
  // Exported for the basket's own search (plan 0055, section 5.1), which
  // resolves the **run's** profile rather than the caller's and must share this
  // resolver's Redis cache and its invalidation rather than growing a second
  // answer to the same question.
  exports: [ScopeResolutionService],
})
export class GatewayCatalogModule {}
