import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { CommentTranscriptionService } from './comment-transcription.service';
import {
  CommentsController,
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
  imports: [MessagingModule],
  controllers: [
    ZoneListsController,
    ListsController,
    LinesController,
    CommentsController,
  ],
  providers: [CommentTranscriptionService, VoiceRecordingInterceptor],
})
export class GatewayListsModule {}
