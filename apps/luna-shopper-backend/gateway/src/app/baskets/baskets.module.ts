import { Module } from '@nestjs/common';
import { GatewayCatalogModule } from '../catalog/catalog.module';
import { GatewayGeneratedListsModule } from '../generated-lists/generated-lists.module';
import { MessagingModule } from '../messaging/messaging.module';
import { BasketCatalogService } from './basket-catalog.service';
import { BasketController, BasketLiveController } from './basket.controller';
import { SettlePriceService } from './settle-price.service';

/**
 * The gateway's basket surface (plan 0136), proxying to core over NATS.
 *
 * Every rule this feature has, from which lists a basket covers to who may
 * settle what, is core's; putting any of it here would give the same question
 * two answers. What lives here is the catalog composition, which is the one
 * thing core cannot do: it holds the basket and references products by an opaque
 * `itemId`, catalog holds the products, and neither can answer this screen
 * alone.
 *
 * ## The controller order is a routing rule
 *
 * {@link BasketLiveController} comes first. `GET /v1/baskets/live` and
 * `GET /v1/baskets/:id` both match the same request, Nest registers routes in
 * controller order and the first match runs, so the literal path has to be
 * registered before the parameter or the participant guard would answer a route
 * that has no participant. `GENERATED_LIST_SHARING_CONTROLLERS` states the same
 * rule for the same reason.
 *
 * ## Why it imports the generated lists module
 *
 * For `ParticipantGuard` and `ParticipantThrottlerGuard`, which the participant
 * surface here is behind. They stay where they are until plan 0144 renames the
 * rest of that folder: a guard copied into two modules would be two instances
 * with two throttler buckets, and the bucket is the rate limit.
 */
@Module({
  imports: [MessagingModule, GatewayCatalogModule, GatewayGeneratedListsModule],
  controllers: [BasketLiveController, BasketController],
  providers: [BasketCatalogService, SettlePriceService],
  // The list page settles too, and a settle from either screen records what was
  // paid (plan 0143). It is exported rather than provided twice, because two
  // instances would be two of everything it caches through.
  exports: [SettlePriceService],
})
export class GatewayBasketsModule {}
