import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { MergeController } from './merge.controller';

/** The gateway's account merge surface (plan 0008), proxying to core over NATS. */
@Module({
  imports: [MessagingModule],
  controllers: [MergeController],
})
export class GatewayMergeModule {}
