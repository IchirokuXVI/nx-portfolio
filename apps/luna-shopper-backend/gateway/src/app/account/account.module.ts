import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { AccountController } from './account.controller';

/** The gateway's account-deletion surface (plan 0011), proxying to auth over NATS. */
@Module({
  imports: [MessagingModule],
  controllers: [AccountController],
})
export class GatewayAccountModule {}
