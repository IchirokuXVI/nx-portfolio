import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CATALOG_ENTITIES } from '../entities';
import { CatalogController } from './catalog.controller';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { SupermarketItemService } from './supermarket-item.service';
import { SupermarketLocationService } from './supermarket-location.service';
import { SupermarketService } from './supermarket.service';

/** The catalog domain slice (plan 0012): items, supermarkets, per location prices. */
@Module({
  imports: [TypeOrmModule.forFeature(CATALOG_ENTITIES)],
  controllers: [CatalogController],
  providers: [
    PlatformAdminService,
    SupermarketService,
    SupermarketLocationService,
    ItemService,
    SupermarketItemService,
  ],
})
export class CatalogModule {}
