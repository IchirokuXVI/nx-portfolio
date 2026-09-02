import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GatewayCatalogModule } from '../catalog/catalog.module';
import type { GatewayConfig } from '../config/app-config';
import { MessagingModule } from '../messaging/messaging.module';
import { BasketPresenceService } from './basket-presence.service';
import { GENERATED_LIST_SHARING_CONTROLLERS } from './generated-list-sharing.controller';
import { GeneratedListController } from './generated-list.controller';
import { ParticipantThrottlerGuard } from './participant-throttler.guard';
import { ParticipantGuard } from './participant.guard';

/**
 * The gateway's generated shopping list surface (plans 0050 and 0051), proxying
 * to core over NATS.
 *
 * Controllers and one guard. Every rule this feature has, from which lists a run
 * may draw to whether an edit reaches a shared list to who may settle what, is
 * core's, and putting any of it here would give the same question two answers.
 * {@link ParticipantGuard} is not an exception: it decides nothing, it turns a
 * presented credential into the participant core resolved it to.
 *
 * ## Why this module registers a `JwtModule` when the rest of the gateway does
 * not
 *
 * Everywhere else the gateway verifies an account token through the passport
 * strategy, which either finds a good token or rejects the request. The join
 * route needs a third answer: **no token at all is the ordinary case**, because
 * the person opening a share link may have no account. So the guard verifies the
 * header itself when there is one, which needs the same public key passport is
 * configured with, and this is where that key is handed to it.
 */
@Module({
  imports: [
    MessagingModule,
    // For `ScopeResolutionService` alone, which the basket's own catalog search
    // uses to price a run's profile (plan 0055, section 5.1). Importing the
    // module rather than providing a second copy is what keeps one Redis cache
    // and one invalidation for both searches.
    GatewayCatalogModule,
    // Offline verification with auth's public key, the same key and algorithm
    // the passport strategy uses (plan 0004, section 10).
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        publicKey: config.getOrThrow<GatewayConfig>('gateway').authJwtPublicKey,
        verifyOptions: { algorithms: ['RS256'] },
      }),
    }),
  ],
  controllers: [GeneratedListController, ...GENERATED_LIST_SHARING_CONTROLLERS],
  // The throttler guard is a provider rather than a bare class in `@UseGuards`
  // so Nest injects the throttler's options and its Redis storage into it, the
  // same two the global guard holds (plan 0055, section 7).
  providers: [
    ParticipantGuard,
    ParticipantThrottlerGuard,
    BasketPresenceService,
  ],
})
export class GatewayGeneratedListsModule {}
