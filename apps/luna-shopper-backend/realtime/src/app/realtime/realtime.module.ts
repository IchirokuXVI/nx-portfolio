import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TokenVerifierService } from '../auth/token-verifier.service';
import type { RealtimeConfig } from '../config/app-config';
import { JetStreamConsumer } from '../consumer/jetstream.consumer';
import {
  CORE_ACCESS_CLIENT,
  CoreAccessClient,
} from '../messaging/core-access.client';
import { PresenceService } from '../presence/presence.service';
import { EventRelayService } from '../relay/event-relay.service';
import { RealtimeGateway } from '../socket/realtime.gateway';
import { RoomSyncService } from '../socket/room-sync.service';
import { SseController } from '../sse/sse.controller';

/**
 * The realtime slice (plan 0009): the JetStream consumer and relay, the two
 * client transports (the socket gateway and the SSE controller), presence, and
 * the two outward links they need — offline token verification (auth's public
 * key) and the request/reply access check to core.
 */
@Module({
  imports: [
    // Offline access-token verification with auth's public key (plan 0009,
    // section 3), mirroring the gateway.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        publicKey:
          config.getOrThrow<RealtimeConfig>('realtime').authJwtPublicKey,
        verifyOptions: { algorithms: ['RS256'] },
      }),
    }),
    // Request/reply link to core for the room authorization checks (section 5).
    ClientsModule.registerAsync([
      {
        name: CORE_ACCESS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: {
            servers: [config.getOrThrow<RealtimeConfig>('realtime').natsUrl],
          },
        }),
      },
    ]),
  ],
  controllers: [SseController],
  providers: [
    EventRelayService,
    JetStreamConsumer,
    PresenceService,
    TokenVerifierService,
    CoreAccessClient,
    RealtimeGateway,
    RoomSyncService,
  ],
})
export class RealtimeModule {}
