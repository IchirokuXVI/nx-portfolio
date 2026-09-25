import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  BASKET_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type BasketParticipantContext,
  type BasketSearchScope,
  type BasketSearchScopeRequest,
  type NearbyShopsView,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketShopLockedException,
  UuidParam,
} from '@portfolio/luna-shopper/platform';
import { toNearbyShopsRequest } from '../catalog/nearby-shops';
import { BasketNearbyShopsDto } from '../catalog/nearby-shops.dto';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { Participant, ParticipantGuard } from './participant.guard';

/**
 * The shops near where a participant is standing, inside a basket (plan
 * 0164), for any participant: the owner, a member, or a guest who opened a
 * link.
 *
 * A controller of its own so that `WithholdBodyMiddleware` applies to this
 * route and to no other: the body is the point, and it never reaches a log.
 * Registered after every other basket controller, which is safe because no
 * literal path of theirs has the shape `:id/shops/nearby`.
 */
@ApiTags('baskets')
@UseGuards(ParticipantGuard)
@Controller({ path: 'baskets', version: '1' })
export class BasketShopsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  /**
   * Every shop within 750 m, nearest first, and the one picked when one is
   * clearly the shop the person is in.
   *
   * **The profile is the basket's pricing profile**, never the reader's own,
   * for the reason every basket read gives: the basket is priced as its owner
   * shops. So `inProfile` and `excluded` are about the owner's profile.
   *
   * A basket started at a shop has nothing to pick, and answers 409
   * `basket_shop_locked` before the point is sent anywhere.
   */
  @Post(':id/shops/nearby')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.nearby, {
    status: HttpStatus.CREATED,
    description:
      'The shops within 750 m of the point, nearest first, judged against the basket’s pricing profile, and either the shop picked or why none was. The point is not stored.',
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    body: true,
    shopLocked: true,
  })
  async nearby(
    @Participant() participant: BasketParticipantContext,
    @UuidParam('id') id: string,
    @Body() dto: BasketNearbyShopsDto
  ): Promise<NearbyShopsView> {
    const req: BasketSearchScopeRequest = {
      basketId: id,
      participantId: participant.participantId,
    };
    const scope = await this.nats.send<BasketSearchScope>(
      BASKET_PATTERNS.searchScope,
      req
    );
    if (scope.supermarketLocationId) {
      throw new BasketShopLockedException(
        'This basket was started at a shop, so there is none to pick'
      );
    }
    const selection = scope.profileId
      ? await this.scopes.forShops(scope.ownerUserId, {
          profileId: scope.profileId,
        })
      : null;
    return this.nats.send<NearbyShopsView>(
      SUPERMARKET_LOCATION_PATTERNS.nearby,
      toNearbyShopsRequest(dto, selection)
    );
  }
}
