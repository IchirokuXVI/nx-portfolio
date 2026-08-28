import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  LinesController,
  ListsController,
  ZoneListsController,
} from './list.controller';

/** The gateway's shopping list surface (plan 0007), proxying to core over NATS. */
@Module({
  imports: [MessagingModule],
  controllers: [ZoneListsController, ListsController, LinesController],
})
export class GatewayListsModule {}
