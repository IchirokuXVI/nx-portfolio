import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ProfileGenerationSource,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Shopping profiles (plan 0049): the four tables, the service that holds their
 * invariants and the NATS surface the gateway calls.
 *
 * It imports {@link ZonesModule} for the event publisher alone, which is where
 * that provider is declared and exported. `profiles.changed` is addressed to the
 * owner's own sessions and to no zone room (section 5), so the import is about
 * the client rather than about zones.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShoppingProfile,
      ProfilePostalCode,
      ProfileSupermarketPreference,
      ProfileGenerationSource,
    ]),
    ZonesModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfilesModule {}
