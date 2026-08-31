import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
} from '../entities';
import { ListsModule } from '../lists/lists.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ZonesModule } from '../zones/zones.module';
import { GeneratedListLineService } from './generated-list-line.service';
import { GeneratedListController } from './generated-list.controller';
import { GeneratedListService } from './generated-list.service';

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
    ]),
    ProfilesModule,
    ListsModule,
    ZonesModule,
  ],
  controllers: [GeneratedListController],
  providers: [GeneratedListService, GeneratedListLineService],
  // Exported so account deletion (plan 0011) can drop a departing user's baskets
  // without reaching into the repositories itself.
  exports: [GeneratedListService],
})
export class GeneratedListsModule {}
