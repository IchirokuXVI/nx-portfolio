import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GatewayCatalogModule } from '../catalog/catalog.module';
import type { GatewayConfig } from '../config/app-config';
import { MessagingModule } from '../messaging/messaging.module';
import { BasketCatalogService } from './basket-catalog.service';
import { BasketPresenceService } from './basket-presence.service';
import { BASKET_SHARING_CONTROLLERS } from './basket-sharing.controller';
import { BasketController, BasketLiveController } from './basket.controller';
import { BasketsController } from './baskets.controller';
import { ParticipantThrottlerGuard } from './participant-throttler.guard';
import { ParticipantGuard } from './participant.guard';
import { SettlePriceService } from './settle-price.service';

/**
 * The gateway's whole basket surface (plans 0050, 0051 and 0136), proxying to
 * core over NATS.
 *
 * One module since plan 0144. It was two, `GatewayGeneratedListsModule` beside
 * this one, for the length of the series plan 0130 opened, and the guards below
 * were exported from one to the other rather than provided twice, because a
 * guard provided twice is two instances with two throttler buckets and the
 * bucket **is** the rate limit. With one module there is nothing to export them
 * to, and one instance is the only instance.
 *
 * Every rule this feature has, from which lists a run may draw to who may settle
 * what, is core's; putting any of it here would give the same question two
 * answers. What lives here is the catalog composition, which is the one thing
 * core cannot do: it holds the basket and references products by an opaque
 * `itemId`, catalog holds the products, and neither can answer this screen
 * alone. {@link ParticipantGuard} is not an exception either: it decides
 * nothing, it turns a presented credential into the participant core resolved
 * it to.
 *
 * ## The controller order is a routing rule
 *
 * Nest registers routes in controller order and the first match runs, so every
 * literal path has to be registered before the parameter that would swallow it:
 *
 * 1. {@link BasketLiveController} — `GET /v1/baskets/live` and `live/summary`.
 * 2. {@link BasketsController} — the collection, and `GET /v1/baskets/shared`.
 * 3. {@link BasketController} — `GET /v1/baskets/:id` and the row writes.
 * 4. `BASKET_SHARING_CONTROLLERS`, which states the same rule internally so
 *    that `:id/participants/mine` wins over `:id/participants/:participantId`.
 *
 * Merging two modules into one is exactly how that order gets lost, so the list
 * below is the rule and `basket-shared.spec.ts` is what proves it.
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
  controllers: [
    BasketLiveController,
    BasketsController,
    BasketController,
    ...BASKET_SHARING_CONTROLLERS,
  ],
  // The throttler guard is a provider rather than a bare class in `@UseGuards`
  // so Nest injects the throttler's options and its Redis storage into it, the
  // same two the global guard holds (plan 0055, section 7).
  providers: [
    BasketCatalogService,
    SettlePriceService,
    ParticipantGuard,
    ParticipantThrottlerGuard,
    BasketPresenceService,
  ],
  // The list page settles too, and a settle from either screen records what was
  // paid (plan 0143). It is exported rather than provided twice, because two
  // instances would be two of everything it caches through.
  exports: [SettlePriceService],
})
export class GatewayBasketsModule {}
