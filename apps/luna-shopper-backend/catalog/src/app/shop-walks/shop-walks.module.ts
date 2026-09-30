import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ShopWalkService } from './shop-walk.service';
import { ShopWalksController } from './shop-walks.controller';

/**
 * A shop's walks, their append only log, and its map (backend plan 0168).
 * Imports the catalog module for `SectionService`, which the shown walk writes
 * the shop's section list through.
 */
@Module({
  imports: [CatalogModule],
  controllers: [ShopWalksController],
  providers: [ShopWalkService],
})
export class ShopWalksModule {}
