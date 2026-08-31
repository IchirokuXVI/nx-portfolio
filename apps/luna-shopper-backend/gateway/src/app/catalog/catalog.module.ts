import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  CatalogItemsController,
  CatalogLocationItemsController,
  CatalogLocationsController,
  CatalogPriceScopesController,
  CatalogProductGroupsController,
  CatalogSuggestController,
  CatalogSupermarketItemsController,
  CatalogSupermarketsController,
} from './catalog.controller';

/**
 * The gateway's catalog surface (plan 0012), proxying to catalog over NATS.
 * Plan 0038 added price scopes and the per store rows, and moved the
 * supermarket-items controller to `v2` because its view lost two fields. Plan
 * 0048 added product groups, the ranked searches and the composer's one
 * suggestion endpoint, which is the only route here that fans out to two
 * subjects rather than proxying one.
 */
@Module({
  imports: [MessagingModule],
  controllers: [
    CatalogSupermarketsController,
    CatalogLocationsController,
    CatalogPriceScopesController,
    CatalogProductGroupsController,
    CatalogSuggestController,
    CatalogItemsController,
    CatalogSupermarketItemsController,
    CatalogLocationItemsController,
  ],
})
export class GatewayCatalogModule {}
