import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BasketCoverageModule } from '../baskets/basket-coverage.module';
import { Zone, ZoneMembership } from '../entities';
import { CoreEventsModule } from '../events/core-events.module';
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
    // The events client and the publisher used to be declared here. They moved
    // out in plan 0139 so that this module and `BasketCoverageModule` can both
    // have them without needing each other.
    CoreEventsModule,
    // A change to who is in the zone changes what the household's open baskets
    // cover (plan 0139, section 5). The coverage module depends on nothing here,
    // which is the property that lets this import exist.
    BasketCoverageModule,
  ],
  controllers: [ZoneController, MembershipController, StatsController],
  providers: [
    ZoneService,
    MembershipService,
    MemberListingService,
    ZoneAuthzService,
    ZoneCountsService,
    StatsService,
  ],
  // Exported so the lists slice (plan 0007) reuses membership resolution, the
  // event publisher and the zone counts rather than re-implementing them.
  //
  // `ZoneService` and `MembershipService` are exported for the back office (plan
  // 0074, section 1): its named actions call the operator variants on these two
  // classes, so the write an operator makes is the write a zone's own admins
  // make. Exporting them is what stops that module from reaching for the
  // repositories and reimplementing the effect.
  //
  // The publisher is re-exported as its **module**, which is the only way since
  // plan 0139 moved it out of here: Nest refuses to export a provider a module
  // does not itself provide, and it refuses it at boot rather than at build, so
  // no amount of compiling or unit testing finds it. Re-exporting the module
  // hands importers the same `CoreEventsPublisher` they always got.
  exports: [
    ZoneAuthzService,
    ZoneCountsService,
    CoreEventsModule,
    ZoneService,
    MembershipService,
  ],
})
export class ZonesModule {}
