import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedEvent, Zone, ZoneMembership } from '../entities';
import { GeneratedListsModule } from '../generated-lists/generated-lists.module';
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
 * reaper. Reuses the event publisher exported by {@link ZonesModule} and the
 * basket service exported by {@link GeneratedListsModule}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Zone, ZoneMembership, ProcessedEvent]),
    ZonesModule,
    // For the `user.deleted` saga alone: a departing account's baskets are
    // private to it and go with it (plan 0050, section 7).
    GeneratedListsModule,
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
