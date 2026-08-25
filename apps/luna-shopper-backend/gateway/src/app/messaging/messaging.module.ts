import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import type { GatewayConfig } from '../config/app-config';
import { NATS_CLIENT, NatsClient } from './nats-client';

/**
 * The gateway's request/reply link to the backend services over NATS. Exported
 * as {@link NatsClient} so every feature controller sends through the same
 * correlation-propagating bridge.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: {
            servers: [config.getOrThrow<GatewayConfig>('gateway').natsUrl],
          },
        }),
      },
    ]),
  ],
  providers: [NatsClient],
  exports: [NatsClient],
})
export class MessagingModule {}
