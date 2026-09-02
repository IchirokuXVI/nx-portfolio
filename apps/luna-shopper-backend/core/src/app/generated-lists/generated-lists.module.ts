import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
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
import { GeneratedListBasketService } from './generated-list-basket.service';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListOriginsService } from './generated-list-origins.service';
import { GeneratedListReopenService } from './generated-list-reopen.service';
import { GeneratedListSettleService } from './generated-list-settle.service';
import { GeneratedListSharingController } from './generated-list-sharing.controller';
import { GeneratedListSharingService } from './generated-list-sharing.service';
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
      GeneratedListLine,
      GeneratedListLineOrigin,
      GeneratedListLineOption,
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
  ],
  controllers: [GeneratedListController, GeneratedListSharingController],
  providers: [
    GeneratedListService,
    GeneratedListLineService,
    GeneratedListSharingService,
    GeneratedListSettleService,
    // The reverse of the settle (plan 0054, section 3), and a provider of its
    // own for the same reason: it is the other operation here that reaches a
    // zone list, with its own transaction and its own announcements.
    GeneratedListReopenService,
    GeneratedListBasketService,
    // Editing what each household asked for, which is deliberately not the
    // settle service (plan 0057, section 1): it changes a zone list without
    // buying anything.
    GeneratedListOriginsService,
  ],
  // Exported so account deletion (plan 0011) can drop a departing user's baskets
  // without reaching into the repositories itself. The sharing service is
  // exported for the same reason plus one more: a settle (plan 0051, section 6)
  // has to resolve the acting participant before it may write anything.
  exports: [GeneratedListService, GeneratedListSharingService],
})
export class GeneratedListsModule {}
