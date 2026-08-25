import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
  ],
  controllers: [MergeController],
  providers: [MergeService],
})
export class MergeModule {}
