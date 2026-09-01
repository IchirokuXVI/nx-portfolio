import { Module } from '@nestjs/common';
import { GeneratedListsModule } from '../generated-lists/generated-lists.module';
import { ListsModule } from '../lists/lists.module';
import { ZonesModule } from '../zones/zones.module';
import { RealtimeAccessController } from './realtime-access.controller';

/**
 * Core's authorization surface for the realtime service (plan 0009, section 5).
 * It exposes nothing new of its own: it reuses {@link ZoneAuthzService} (from
 * {@link ZonesModule}), {@link ListAccessService} (from {@link ListsModule}) and
 * {@link GeneratedListSharingService} (from {@link GeneratedListsModule}) to
 * answer the room subscription checks over NATS.
 *
 * The third is plan 0051, section 7, and it is the only one of the three that
 * answers about a **participant** rather than a user, because the `generated:`
 * rooms are the only ones a guest can be in.
 */
@Module({
  imports: [ZonesModule, ListsModule, GeneratedListsModule],
  controllers: [RealtimeAccessController],
})
export class RealtimeAccessModule {}
