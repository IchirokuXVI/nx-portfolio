import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedEvent, Zone, ZoneMembership } from '../entities';
import { ZonesModule } from '../zones/zones.module';
import { AccountDeletionService } from './account-deletion.service';
import { ProcessedEventStore } from './idempotency.store';
import { AccountController } from './reconciliation.controller';
import { ZoneReaperService } from './zone-reaper.service';

/**
 * Account deletion + zone ownership fallback (plan 0011): the `user.deleted` saga,
 * the reconciliation query for the orphan reaper, and the zone reaper. Reuses the
 * event publisher exported by {@link ZonesModule}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Zone, ZoneMembership, ProcessedEvent]),
    ZonesModule,
  ],
  controllers: [AccountController],
  providers: [AccountDeletionService, ProcessedEventStore, ZoneReaperService],
})
export class AccountModule {}
