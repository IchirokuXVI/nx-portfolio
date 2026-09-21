import { Module } from '@nestjs/common';
import { GatewayBasketsModule } from '../baskets/baskets.module';
import { MessagingModule } from '../messaging/messaging.module';
import { CommentTranscriptionService } from './comment-transcription.service';
import {
  CommentsController,
  ItemHistoryController,
  LinesController,
  ListsController,
  ZoneListsController,
} from './list.controller';
import { VoiceRecordingInterceptor } from './voice-recording.interceptor';

/**
 * The gateway's shopping list surface (plan 0007), proxying to core over NATS.
 *
 * Since plan 0045 it also owns the one multipart route in this backend and the
 * transcription orchestration behind it. Both are providers rather than being
 * global, because voice comments are the only thing in the gateway that uploads
 * a file or talks to two services in one request.
 */
@Module({
  // The baskets module for `SettlePriceService` alone (plan 0143): a settle
  // from the list page records what was paid exactly as a settle from a basket
  // does, and the one service is where that rule lives.
  imports: [MessagingModule, GatewayBasketsModule],
  controllers: [
    ZoneListsController,
    ListsController,
    LinesController,
    CommentsController,
    // One product's purchase history, keyed on a catalog item and served by core
    // (plan 0047, section 6.2).
    ItemHistoryController,
  ],
  providers: [CommentTranscriptionService, VoiceRecordingInterceptor],
})
export class GatewayListsModule {}
