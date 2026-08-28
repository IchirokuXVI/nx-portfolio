import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  CatalogItemsController,
  CatalogLocationsController,
  CatalogSupermarketItemsController,
  CatalogSupermarketsController,
} from './catalog.controller';

/** The gateway's catalog surface (plan 0012), proxying to catalog over NATS. */
@Module({
  imports: [MessagingModule],
  controllers: [
    CatalogSupermarketsController,
    CatalogLocationsController,
    CatalogItemsController,
    CatalogSupermarketItemsController,
  ],
})
export class GatewayCatalogModule {}
