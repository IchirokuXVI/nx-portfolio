import { Module } from '@nestjs/common';
import { BasketsModule } from '../baskets/baskets.module';
import { ListsModule } from '../lists/lists.module';
import { ZonesModule } from '../zones/zones.module';
import { RealtimeAccessController } from './realtime-access.controller';

/**
 * Core's authorization surface for the realtime service (plan 0009, section 5).
 * It exposes nothing new of its own: it reuses {@link ZoneAuthzService} (from
 * {@link ZonesModule}), {@link ListAccessService} (from {@link ListsModule}) and
 * {@link BasketSharingService} (from {@link BasketsModule}) to
 * answer the room subscription checks over NATS.
 *
 * The third is plan 0051, section 7, and it is the only one of the three that
 * answers about a **participant** rather than a user, because the `basket:`
 * rooms are the only ones a guest can be in.
 */
@Module({
  imports: [ZonesModule, ListsModule, BasketsModule],
  controllers: [RealtimeAccessController],
})
export class RealtimeAccessModule {}
