import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { CoreConfig } from '../config/app-config';
import { Zone, ZoneMembership } from '../entities';
import {
  CoreEventsPublisher,
  NATS_EVENTS,
} from '../events/core-events.publisher';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { ZoneAuthzService } from './zone-authz.service';
import { ZoneController } from './zone.controller';
import { ZoneService } from './zone.service';

/**
 * Zones and membership (plan 0006): the first domain slice of core. Bundles the
 * entities, the domain services and their NATS controllers, plus the client used
 * to publish domain events for the realtime fan out.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Zone, ZoneMembership]),
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
  controllers: [ZoneController, MembershipController],
  providers: [
    ZoneService,
    MembershipService,
    ZoneAuthzService,
    CoreEventsPublisher,
  ],
  // Exported so the lists slice (plan 0007) reuses membership resolution and the
  // event publisher rather than re-implementing them.
  exports: [ZoneAuthzService, CoreEventsPublisher],
})
export class ZonesModule {}
