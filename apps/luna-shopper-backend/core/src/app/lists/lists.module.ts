import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommentAudio,
  LineComment,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineItem,
  ShoppingList,
  ZoneMembership,
} from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { CommentService } from './comment.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { ListController } from './list.controller';
import { ListService } from './list.service';
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
      LineComment,
      LineSettlement,
      CommentAudio,
      ZoneMembership,
    ]),
    ZonesModule,
    SharedListGrantModule,
  ],
  controllers: [ListController],
  providers: [
    ListService,
    LineService,
    CommentService,
    SettlementService,
    ListAccessService,
  ],
  // Exported so the realtime access checks (plan 0009) can reuse list-access
  // resolution rather than re-implementing it.
  exports: [ListAccessService],
})
export class ListsModule {}
