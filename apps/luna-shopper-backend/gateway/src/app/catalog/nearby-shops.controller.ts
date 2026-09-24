import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  SUPERMARKET_LOCATION_PATTERNS,
  type NearbyShopsView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import { toNearbyShopsRequest } from './nearby-shops';
import { NearbyShopsDto } from './nearby-shops.dto';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * The shops near where a signed in person is standing (plan 0164), for the
 * get a list sheet, where no basket exists yet.
 *
 * **Distance is the axis here, and only here.** `GET /v1/catalog/shops` keeps
 * a profile's shops by postal code (plan 0068, section 3.3); this reverses that
 * for one purpose, choosing where to buy now.
 *
 * A controller of its own so that `WithholdBodyMiddleware` applies to this
 * route and to no other: the body is the point, and it never reaches a log.
 * `POST` for a read, like `POST /v1/account/postal-code-lookups`, and it
 * answers 201 like every POST in this gateway.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/shops', version: '1' })
export class CatalogNearbyShopsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  /**
   * Every shop within 750 m, nearest first, and the one picked for the caller
   * when one is clearly the shop they are in. The profile is the one named,
   * else the caller's default.
   */
  @Post('nearby')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.nearby, {
    status: HttpStatus.CREATED,
    description:
      'The shops within 750 m of the point, nearest first, and either the shop picked for you or why none was. The point is not stored.',
  })
  @ApiProblemResponses({ auth: true, body: true, notFound: true })
  async nearby(
    @AuthUser() user: CurrentUser,
    @Body() dto: NearbyShopsDto
  ): Promise<NearbyShopsView> {
    const selection = await this.scopes.forShops(user.userId, {
      profileId: dto.profileId,
    });
    return this.nats.send<NearbyShopsView>(
      SUPERMARKET_LOCATION_PATTERNS.nearby,
      toNearbyShopsRequest(dto, selection)
    );
  }
}
