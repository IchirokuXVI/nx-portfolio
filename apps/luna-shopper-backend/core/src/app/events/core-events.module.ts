import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import type { CoreConfig } from '../config/app-config';
import { CoreEventsPublisher, NATS_EVENTS } from './core-events.publisher';

/**
 * The events client and the publisher, in a module of its own.
 *
 * They were providers of `ZonesModule`, which was true while every module that
 * published an event could import that one. Plan 0139 breaks it: `BasketAnnouncer`
 * publishes, so `BasketCoverageModule` needs the publisher, and `MembershipService`
 * announces, so `ZonesModule` needs the announcer. Two modules that need each
 * other is a cycle, and lifting the shared half into a module neither owns is what
 * resolves it rather than a `forwardRef` or a second NATS connection.
 *
 * `ZonesModule` still exports {@link CoreEventsPublisher}, so every module that
 * reaches for it through that import keeps working and nothing else moved.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NATS_EVENTS,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: { servers: [config.getOrThrow<CoreConfig>('core').natsUrl] },
        }),
      },
    ]),
  ],
  providers: [CoreEventsPublisher],
  exports: [CoreEventsPublisher],
})
export class CoreEventsModule {}
