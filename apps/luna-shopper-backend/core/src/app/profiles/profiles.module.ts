import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { CoreConfig } from '../config/app-config';
import {
  ProfileGenerationSource,
  ProfileLocationPreference,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';
import { ZonesModule } from '../zones/zones.module';
import {
  POSTAL_CODE_NATS_CLIENT,
  PostalCodeClient,
} from './postal-code.client';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Shopping profiles (plan 0049, and the fifth table in plan 0064): the tables,
 * the service that holds their invariants and the NATS surface the gateway
 * calls.
 *
 * It imports {@link ZonesModule} for the event publisher alone, which is where
 * that provider is declared and exported. `profiles.changed` is addressed to the
 * owner's own sessions and to no zone room (section 5), so the import is about
 * the client rather than about zones.
 *
 * It also registers a NATS **client** of its own (plan 0062). Core answering and
 * calling is unusual here, and it is the same reason the harvester does both: a
 * postal code's neighbours live in catalog's centroid table, the boundary says
 * core may only reach them over the broker, and the announcement plan 0063 will
 * consume goes out on the same connection.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShoppingProfile,
      ProfilePostalCode,
      ProfileSupermarketPreference,
      ProfileLocationPreference,
      ProfileGenerationSource,
    ]),
    ZonesModule,
    ClientsModule.registerAsync([
      {
        name: POSTAL_CODE_NATS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: { servers: [config.getOrThrow<CoreConfig>('core').natsUrl] },
        }),
      },
    ]),
  ],
  controllers: [ProfileController],
  providers: [ProfileService, PostalCodeClient],
  exports: [ProfileService],
})
export class ProfilesModule {}
