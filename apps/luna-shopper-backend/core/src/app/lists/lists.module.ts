import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BasketCoverageModule } from '../baskets/basket-coverage.module';
import {
  CommentAudio,
  LineComment,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineChange,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  ZoneMembership,
} from '../entities';
import { IdempotencyModule } from '../events/idempotency.module';
import { LineClaimModule } from '../generated-lists/line-claim.module';
import { ZonesModule } from '../zones/zones.module';
import { LineChangeRecorder } from './changes/line-change.recorder';
import { ListLineChangeSweepService } from './changes/list-line-change-sweep.service';
import { CommentService } from './comment.service';
import { LineMergeService } from './line-merge.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { ListController } from './list.controller';
import { ListService } from './list.service';
import { ProductGroupSyncController } from './product-group-sync.controller';
import { ProductGroupSyncService } from './product-group-sync.service';
import { SettlementService } from './settlement.service';
import { SharedListGrantModule } from './shared-list-grant.module';
import { SuggestionsController } from './suggestions/suggestions.controller';
import { SuggestionsService } from './suggestions/suggestions.service';
import { TripsController } from './trips/trips.controller';
import { TripsService } from './trips/trips.service';

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
      // What changed on a list (plan 0138). Registered so the sweep has a
      // repository; the recorder holds none and writes through its caller's
      // manager, and the two reads are raw statements in `baskets/changes`.
      ListLineChange,
    ]),
    ZonesModule,
    SharedListGrantModule,
    // Every write to a list line is a write to every basket that covers the list
    // (plan 0139, section 3). The coverage module depends on nothing here, which
    // is why `GeneratedListsModule` and this one can both import it.
    BasketCoverageModule,
    // The third indicator on a line (plan 0052). A module of its own rather than
    // `GeneratedListsModule`, which imports this one, on exactly the reasoning
    // `SharedListGrantModule` above it exists for.
    LineClaimModule,
    // The `processed_events` inbox the catalog event handlers dedupe on (plan
    // 0070, section 5.1).
    IdempotencyModule,
  ],
  controllers: [
    ListController,
    ProductGroupSyncController,
    TripsController,
    SuggestionsController,
  ],
  providers: [
    ListService,
    LineService,
    // Two lines becoming one on a rename (plan 0112). A provider of its own
    // because a basket rename merges list lines too (plan 0113).
    LineMergeService,
    // What changed on a list, written in the transaction of the write that
    // changed it (plan 0138). It holds no repository, so it is a provider here
    // rather than a module: every insert goes through its caller's manager.
    LineChangeRecorder,
    // ...and the sweep that deletes a change nobody may read any more. Here
    // rather than beside the basket reads, because the record belongs to the
    // list: a change outlives every basket that covered it.
    ListLineChangeSweepService,
    CommentService,
    SettlementService,
    // The shopping trips that touched a list, derived on read (plan 0122).
    TripsService,
    // The lines at zero a list offers back, derived on read (plan 0123).
    SuggestionsService,
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
  //
  // `ListService` and the same `LineService` are exported for the back office
  // (plan 0077, sections 5.1 and 5.2): its edits call the operator variants on
  // these two classes, so an operator's change to a household's list is the write
  // that household's own admin makes. Exporting them is what stops the admin
  // module reaching for the repositories and reimplementing the effect.
  exports: [ListAccessService, ListService, LineService],
})
export class ListsModule {}
