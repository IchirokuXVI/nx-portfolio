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
import { SharedListGrantModule } from '../lists/shared-list-grant.module';
import { MemberListingService } from './member-listing.service';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { ZoneAuthzService } from './zone-authz.service';
import { ZoneCountsService } from './zone-counts.service';
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
    // Approving somebody into a zone grants them its shared lists (plan 0042,
    // section 2.3). The grant lives in a module of its own precisely so this
    // import is not `ListsModule`, which imports this one.
    SharedListGrantModule,
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
  controllers: [ZoneController, MembershipController, StatsController],
  providers: [
    ZoneService,
    MembershipService,
    MemberListingService,
    ZoneAuthzService,
    ZoneCountsService,
    StatsService,
    CoreEventsPublisher,
  ],
  // Exported so the lists slice (plan 0007) reuses membership resolution, the
  // event publisher and the zone counts rather than re-implementing them.
  exports: [ZoneAuthzService, ZoneCountsService, CoreEventsPublisher],
})
export class ZonesModule {}
