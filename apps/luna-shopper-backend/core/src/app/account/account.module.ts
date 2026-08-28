import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedEvent, Zone, ZoneMembership } from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { AccountDeletionService } from './account-deletion.service';
import { ProcessedEventStore } from './idempotency.store';
import { AccountController } from './reconciliation.controller';
import { UsernamePropagationService } from './username-propagation.service';
import { ZoneReaperService } from './zone-reaper.service';

/**
 * The identity-event sagas and the account housekeeping: the `user.deleted` saga
 * and zone ownership fallback (plan 0011), the `user.usernameChanged` propagation
 * saga (plan 0018), the reconciliation query for the orphan reaper, and the zone
 * reaper. Reuses the event publisher exported by {@link ZonesModule}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Zone, ZoneMembership, ProcessedEvent]),
    ZonesModule,
  ],
  controllers: [AccountController],
  providers: [
    AccountDeletionService,
    UsernamePropagationService,
    ProcessedEventStore,
    ZoneReaperService,
  ],
})
export class AccountModule {}
