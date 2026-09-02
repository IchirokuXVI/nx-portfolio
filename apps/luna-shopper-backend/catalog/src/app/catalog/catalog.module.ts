import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CATALOG_ENTITIES } from '../entities';
import { CatalogController } from './catalog.controller';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';
import { ScopeResolverService } from './scope-resolver.service';
import { SupermarketItemService } from './supermarket-item.service';
import { SupermarketLocationItemService } from './supermarket-location-item.service';
import { SupermarketLocationService } from './supermarket-location.service';
import { SupermarketService } from './supermarket.service';

/**
 * The catalog domain slice (plan 0012): items, supermarkets and their prices.
 * Since plan 0038 a price is keyed on a {@link PriceScopeService} scope rather
 * than on a store, and what is genuinely per store lives beside it.
 */
@Module({
  imports: [TypeOrmModule.forFeature(CATALOG_ENTITIES)],
  controllers: [CatalogController],
  providers: [
    PlatformAdminService,
    SupermarketService,
    PriceScopeService,
    SupermarketLocationService,
    ProductGroupService,
    ItemService,
    // Turns a place into the scopes that price it today (plan 0049).
    ScopeResolverService,
    // Turns a point into a postal code, and a code into its neighbours (plan 0060).
    PostalCodeService,
    SupermarketItemService,
    SupermarketLocationItemService,
  ],
})
export class CatalogModule {}
