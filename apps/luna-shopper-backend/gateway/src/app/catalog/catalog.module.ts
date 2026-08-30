import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  CatalogItemsController,
  CatalogLocationItemsController,
  CatalogLocationsController,
  CatalogPriceScopesController,
  CatalogSupermarketItemsController,
  CatalogSupermarketsController,
} from './catalog.controller';

/**
 * The gateway's catalog surface (plan 0012), proxying to catalog over NATS.
 * Plan 0038 added price scopes and the per store rows, and moved the
 * supermarket-items controller to `v2` because its view lost two fields.
 */
@Module({
  imports: [MessagingModule],
  controllers: [
    CatalogSupermarketsController,
    CatalogLocationsController,
    CatalogPriceScopesController,
    CatalogItemsController,
    CatalogSupermarketItemsController,
    CatalogLocationItemsController,
  ],
})
export class GatewayCatalogModule {}
