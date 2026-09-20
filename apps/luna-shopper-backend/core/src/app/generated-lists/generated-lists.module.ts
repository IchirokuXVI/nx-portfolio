import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BasketCoverageModule } from '../baskets/basket-coverage.module';
import { BasketDemandService } from '../baskets/basket-demand.service';
import { BasketLineAddService } from '../baskets/basket-line-add.service';
import { BasketLiveService } from '../baskets/basket-live.service';
import { BasketReadService } from '../baskets/basket-read.service';
import { BasketRevertService } from '../baskets/basket-revert.service';
import { BasketRowRenameService } from '../baskets/basket-row-rename.service';
import { BasketRowResolver } from '../baskets/basket-row-resolver';
import { BasketSettleService } from '../baskets/basket-settle.service';
import { BasketSkipService } from '../baskets/basket-skip.service';
import { BasketWriteContext } from '../baskets/basket-write.context';
import { BasketWriteController } from '../baskets/basket-write.controller';
import { BasketController } from '../baskets/basket.controller';
import {
  BasketLineSkip,
  BasketSource,
  BasketTripRow,
  GeneratedList,
  GeneratedListParticipant,
  GeneratedListShareLink,
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
} from '../entities';
import { ListsModule } from '../lists/lists.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ZonesModule } from '../zones/zones.module';
import { BasketTripRowsService } from './basket-trip-rows.service';
import { GeneratedListMembersService } from './generated-list-members.service';
import { GeneratedListOrderService } from './generated-list-order.service';
import { GeneratedListSharingController } from './generated-list-sharing.controller';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListSweepService } from './generated-list-sweep.service';
import { GeneratedListController } from './generated-list.controller';
import { GeneratedListService } from './generated-list.service';
import { LineClaimModule } from './line-claim.module';

/**
 * Generated shopping lists (plan 0050): the four tables, the run that composes
 * one, the editing rules that keep it local, and the NATS surface the gateway
 * calls.
 *
 * Three imports, and each is for one thing:
 *
 * - {@link ProfilesModule} resolves which zones and lists a run draws from when
 *   the request does not name them (plan 0049, section 1).
 * - {@link ListsModule} is the write back path. An `ADDED` line with a target
 *   list is created through `LineService.add`, so the ordinary access check, the
 *   ordinary approval rules and the ordinary `line.added` event all apply, and
 *   `ListAccessService` answers which zone a target list belongs to.
 * - {@link ZonesModule} is for the event publisher alone, which is where that
 *   provider is declared and exported. Every event here goes to the owner's own
 *   sessions and to no zone room (section 8), so the import is about the client
 *   rather than about zones.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedList,
      // What the run was asked to draw from (plan 0133), written by the run and
      // read back on every view of a basket.
      BasketSource,
      // What each finished trip asked of each zone line (plan 0135). Registered
      // so the entity is part of the data source; the freeze and the thaw are
      // raw statements on the caller's manager.
      BasketTripRow,
      // One basket's "not today" on one covered line (plan 0137). Registered so
      // the entity is part of the data source and the `PUT` can insert through
      // it; every read of the table is a raw statement.
      BasketLineSkip,
      // Sharing (plan 0051): the link and the people who arrived by it.
      GeneratedListShareLink,
      GeneratedListParticipant,
      // Settling reaches the zone lines the basket came from (section 6), and
      // writes plan 0047's table with a participant instead of a user.
      ListLine,
      ListLineItem,
      LineSettlement,
      // Read only, to name a source list for a reader who passes section 5.2.
      ShoppingList,
    ]),
    ProfilesModule,
    ListsModule,
    ZonesModule,
    // The one zone event a basket emits (plan 0052). `ListsModule` imports it
    // too, which is why it is a module rather than a provider declared here.
    LineClaimModule,
    // What a basket covers, now (plan 0133, section 5). A module of its own for
    // the same reason `LineClaimModule` is one: `ListsModule` needs it in plan
    // 0139 and already points the other way.
    BasketCoverageModule,
  ],
  controllers: [
    GeneratedListController,
    GeneratedListSharingController,
    // The basket's own reads (plan 0136). Its files live in `baskets/` and its
    // providers are declared here rather than in a module of their own, because
    // the finish freezes a trip's rows from `BasketReadService` and the history
    // counts an open basket through it: a `BasketsModule` would have to import
    // this one and be imported by it.
    BasketController,
    BasketWriteController,
  ],
  providers: [
    GeneratedListService,
    // The basket read, and the basket that is always there (plan 0136).
    BasketReadService,
    BasketLiveService,
    // The five writes on a row, and the three things all of them need: a key
    // resolved back to list lines, the coverage and redaction they resolve
    // against, and the answer shape they share.
    BasketRowResolver,
    BasketWriteContext,
    BasketSettleService,
    BasketRevertService,
    BasketDemandService,
    BasketLineAddService,
    BasketRowRenameService,
    // "Not today" on a row, and taking it back (plan 0137). A provider of its
    // own like the others, and the one that writes no settlement: a purchase
    // through this basket ends a skip through a `WHERE` rather than a write.
    BasketSkipService,
    // The freeze and the thaw of a trip's ask (plan 0135). A provider of its
    // own rather than two private methods, because it is the seam plan 0136
    // replaces: the statement changes and its caller does not.
    BasketTripRowsService,
    // The order a shopper walks (plan 0110). The run asks it once, between
    // composing a basket and writing it, and nothing asks it again.
    GeneratedListOrderService,
    GeneratedListSharingService,
    // The people an owner shares a basket with on purpose (plan 0114). The run
    // and the share sheet both add people, so the contact check, the name rule
    // and the row table live here rather than in either of them.
    GeneratedListMembersService,
    // The reverse of the settle (plan 0054, section 3), and a provider of its
    // own for the same reason: it is the other operation here that reaches a
    // zone list, with its own transaction and its own announcements.
    // Moving what is still to get (plan 0056, rewritten by plan 0104). Small,
    // because neither direction is implemented in it: lowering calls the settle
    // above it and raising calls the reopen's walk, rather than either of them
    // settling its own way.
    // A line split by the product that was got (plan 0094). A provider of its
    // own rather than a method on the basket service, because it is the one
    // write here that creates rows, folds rows away and moves provenance rows
    // between them, all in one transaction, and it replaced the pick that did
    // live there.
    // Editing what each household asked for, which is deliberately not the
    // settle service (plan 0057, section 1): it changes a zone list without
    // buying anything. Since plan 0092 it is also the one gesture that takes a
    // line out of the basket, because raising a list from zero is what sending
    // a line there means, and plan 0058's separate bind service went with it.
    // What one list **got**, which is deliberately not the service above it
    // (plan 0104, section 4): that one says what a household asked for, this one
    // says how much of it this basket bought for them, and the two move in
    // opposite directions on the same row of the same sheet.
    // Renaming a basket line and every zone line it came from (plan 0113). A
    // provider of its own, because it is the one write here that renames zone
    // lines, merges them through plan 0112's merge, and merges two basket lines,
    // all in one transaction. The owner's line edit calls it too.
    // The purchases waiting for a list to arrive (plan 0092 section 4.3, filled
    // by plan 0093). It does nothing yet, and it is provided rather than left
    // out so the two origin inserts already call the one method.
    // The backstop for a trip nobody finished (plan 0059, section 4). A timer
    // in the zone reaper's shape that finishes live baskets past the claim
    // window, through `GeneratedListService.update` so the release is heard.
    GeneratedListSweepService,
  ],
  // Exported so account deletion (plan 0011) can drop a departing user's baskets
  // without reaching into the repositories itself. The sharing service is
  // exported for the same reason plus one more: a settle (plan 0051, section 6)
  // has to resolve the acting participant before it may write anything.
  exports: [
    GeneratedListService,
    GeneratedListSharingService,
    // The admin back office counts an open basket's rows through it (plan 0136,
    // section 7.5), and so does the history.
    BasketReadService,
  ],
})
export class GeneratedListsModule {}
