import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { ZoneController } from './zone.controller';

/** The gateway's zone surface (plan 0006), proxying to core over NATS. */
@Module({
  imports: [MessagingModule],
  controllers: [ZoneController],
})
export class GatewayZonesModule {}
