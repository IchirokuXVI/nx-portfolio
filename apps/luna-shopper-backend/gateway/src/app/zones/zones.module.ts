import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { ContactsController } from './contacts.controller';
import { ZoneController } from './zone.controller';

/**
 * The gateway's zone surface (plan 0006), proxying to core over NATS, and the
 * contacts read across every zone the caller is in (plan 0114, section 2).
 */
@Module({
  imports: [MessagingModule],
  controllers: [ZoneController, ContactsController],
})
export class GatewayZonesModule {}
