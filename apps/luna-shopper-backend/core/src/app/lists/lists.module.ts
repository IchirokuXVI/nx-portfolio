import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommentAudio,
  LineComment,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  ZoneMembership,
} from '../entities';
import { IdempotencyModule } from '../events/idempotency.module';
import { LineClaimModule } from '../generated-lists/line-claim.module';
import { ZonesModule } from '../zones/zones.module';
import { CommentService } from './comment.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { ListController } from './list.controller';
import { ListService } from './list.service';
import { ProductGroupSyncController } from './product-group-sync.controller';
import { ProductGroupSyncService } from './product-group-sync.service';
import { SettlementService } from './settlement.service';
import { SharedListGrantModule } from './shared-list-grant.module';

/**
 * Shopping lists, lines and comments (plan 0007): the second domain slice of
 * core. Reuses the zone authorization and event publisher exported by
 * {@link ZonesModule}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShoppingList,
      ListAccess,
      ListLine,
      ListLineItem,
      // The tombstones a subscribed line's edits leave (plan 0070, section 2).
      ListLineGroupRemoval,
      LineComment,
      LineSettlement,
      CommentAudio,
      ZoneMembership,
    ]),
    ZonesModule,
    SharedListGrantModule,
    // The third indicator on a line (plan 0052). A module of its own rather than
    // `GeneratedListsModule`, which imports this one, on exactly the reasoning
    // `SharedListGrantModule` above it exists for.
    LineClaimModule,
    // The `processed_events` inbox the catalog event handlers dedupe on (plan
    // 0070, section 5.1).
    IdempotencyModule,
  ],
  controllers: [ListController, ProductGroupSyncController],
  providers: [
    ListService,
    LineService,
    CommentService,
    SettlementService,
    ListAccessService,
    // Catalog's group membership, reconciled into subscribed lines (plan 0070).
    ProductGroupSyncService,
  ],
  // `ListAccessService` is exported so the realtime access checks (plan 0009)
  // can reuse list-access resolution rather than re-implementing it.
  //
  // `LineService` is exported for the basket write back (plan 0050, section 5):
  // an added line with a target list is created through `add` rather than by an
  // insert of its own, so the ordinary access check, the ordinary approval rules
  // and the ordinary `line.added` event all apply to it.
  exports: [ListAccessService, LineService],
})
export class ListsModule {}
