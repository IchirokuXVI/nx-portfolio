import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  CatalogItemsController,
  CatalogLocationItemsController,
  CatalogLocationsController,
  CatalogPriceScopesController,
  CatalogProductGroupsController,
  CatalogScopeController,
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
 * instead of using it.
 */
@Module({
  imports: [MessagingModule],
  controllers: [
    CatalogSupermarketsController,
    CatalogLocationsController,
    CatalogPriceScopesController,
    CatalogProductGroupsController,
    CatalogScopeController,
    CatalogSuggestController,
    CatalogItemsController,
    CatalogSupermarketItemsController,
    CatalogLocationItemsController,
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
