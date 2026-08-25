import { Module } from '@nestjs/common';
import { ListsModule } from '../lists/lists.module';
import { ZonesModule } from '../zones/zones.module';
import { RealtimeAccessController } from './realtime-access.controller';

/**
 * Core's authorization surface for the realtime service (plan 0009, section 5).
 * It exposes nothing new of its own: it reuses {@link ZoneAuthzService} (from
 * {@link ZonesModule}) and {@link ListAccessService} (from {@link ListsModule})
 * to answer the room subscription checks over NATS.
 */
@Module({
  imports: [ZonesModule, ListsModule],
  controllers: [RealtimeAccessController],
})
export class RealtimeAccessModule {}
