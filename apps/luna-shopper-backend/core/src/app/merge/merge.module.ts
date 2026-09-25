import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BasketCoverageModule } from '../baskets/basket-coverage.module';
import {
  LineComment,
  ListAccess,
  ListLine,
  MergeRequest,
  ShoppingList,
  ZoneMembership,
} from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { MergeController } from './merge.controller';
import { MergeService } from './merge.service';

/**
 * Account merge (plan 0008): the third domain slice of core. Reuses the zone
 * authorization and event publisher from {@link ZonesModule}; the merge itself
 * reassigns rows across the list, line and comment tables, so it registers those
 * entities to reach them within one transaction.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MergeRequest,
      ZoneMembership,
      ShoppingList,
      ListAccess,
      ListLine,
      LineComment,
    ]),
    ZonesModule,
    // An approval moves two memberships, and with them what the household's open
    // baskets cover (plan 0139, section 5).
    BasketCoverageModule,
  ],
  controllers: [MergeController],
  providers: [MergeService],
})
export class MergeModule {}
