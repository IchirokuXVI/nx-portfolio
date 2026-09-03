import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import {
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { AdminListService } from './admin-list.service';
import { AdminZoneService } from './admin-zone.service';
import { CoreAdminController } from './admin.controller';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * The back office's half of core (plan 0074).
 *
 * A module of its own, and it imports the two slices whose services it delegates
 * to rather than reaching into their repositories: `ZonesModule` for the join
 * code and ownership writes and for kicking and banning, `AccountModule` for the
 * reaper that defines what deleting a zone means. That is section 1 expressed as
 * a dependency graph. If a named action here could be written without one of
 * these imports, it would be a row write, which is exactly what the plan forbids.
 *
 * `JwtModule.register({})` for the same reason auth and catalog register it:
 * `JwtService` verifies with a key passed per call, so no global secret is
 * configured and the key comes from `core.adminJwtPublicKey`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Zone,
      ZoneMembership,
      ShoppingList,
      ListLine,
      GeneratedList,
      GeneratedListLine,
      GeneratedListLineOrigin,
    ]),
    JwtModule.register({}),
    ZonesModule,
    AccountModule,
  ],
  controllers: [CoreAdminController],
  providers: [CorePlatformAdminService, AdminZoneService, AdminListService],
})
export class CoreAdminModule {}
