import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  LineComment,
  ListAccess,
  ListLine,
  ShoppingList,
  ZoneMembership,
} from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { CommentService } from './comment.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { ListController } from './list.controller';
import { ListService } from './list.service';

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
      LineComment,
      ZoneMembership,
    ]),
    ZonesModule,
  ],
  controllers: [ListController],
  providers: [ListService, LineService, CommentService, ListAccessService],
})
export class ListsModule {}
