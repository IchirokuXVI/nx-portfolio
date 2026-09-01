import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { GeneratedListController } from './generated-list.controller';

/**
 * The gateway's generated shopping list surface (plan 0050), proxying to core
 * over NATS.
 *
 * A controller and nothing else. Every rule this feature has, from which lists a
 * run may draw to whether an edit reaches a shared list, is core's, and putting
 * any of it here would give the same question two answers.
 */
@Module({
  imports: [MessagingModule],
  controllers: [GeneratedListController],
})
export class GatewayGeneratedListsModule {}
