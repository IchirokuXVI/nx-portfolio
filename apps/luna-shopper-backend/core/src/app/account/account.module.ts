import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Zone, ZoneMembership } from '../entities';
import { IdempotencyModule } from '../events/idempotency.module';
import { GeneratedListsModule } from '../generated-lists/generated-lists.module';
import { ZonesModule } from '../zones/zones.module';
import { AccountDeletionService } from './account-deletion.service';
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
    TypeOrmModule.forFeature([Zone, ZoneMembership]),
    // The inbox both identity sagas dedupe on. A module of its own since plan
    // 0070, because the product group sync needs the same store from a slice
    // that cannot import this one (see IdempotencyModule).
    IdempotencyModule,
    ZonesModule,
    // For the `user.deleted` saga alone: a departing account's baskets are
    // private to it and go with it (plan 0050, section 7).
    GeneratedListsModule,
  ],
  controllers: [AccountController],
  providers: [
    AccountDeletionService,
    UsernamePropagationService,
    ZoneReaperService,
  ],
  // The reaper is exported for the back office (plan 0074, section 1): an
  // operator deleting a zone runs `deleteZone`, the same write the reaper runs
  // on an abandoned one, so the two cannot come to mean different things.
  exports: [ZoneReaperService],
})
export class AccountModule {}
