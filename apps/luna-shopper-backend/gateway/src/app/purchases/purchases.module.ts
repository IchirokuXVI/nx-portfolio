import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { PurchaseController } from './purchase.controller';

/**
 * The gateway's history surface (plan 0142), proxying straight to core.
 *
 * Nothing but the broker: there is no catalog composition to do here, because
 * a row carries the `itemId` it was bought under and the client resolves the
 * product the way every other screen does.
 */
@Module({
  imports: [MessagingModule],
  controllers: [PurchaseController],
})
export class GatewayPurchasesModule {}
