import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PURCHASE_PATTERNS,
  PURCHASE_SCHEMA_IDS,
  SUPERMARKET_LOCATION_PATTERNS,
  type RecentShopIdsView,
  type RecentShopsView,
  type ShopsByIdRequest,
  type ShopsByIdView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { ApiComposedResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';

/**
 * The shops the caller bought at recently (plan 0164, section 4), which the
 * shop picker draws first.
 *
 * **The caller's own, and nobody else's.** The user id comes from the token
 * and is never a parameter; core answers from the caller's own purchases. It
 * is per person, never per household, because a shop says where this person
 * stands. A link visitor has no account and so no token for this route, which
 * is the whole of "a guest has no recent shops".
 *
 * Composed here from two services: core knows which shop ids the caller
 * bought at and when, and catalog knows what those shops are called. A shop
 * catalog no longer holds is left out.
 */
@ApiTags('account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'account', version: '1' })
export class RecentShopsController {
  constructor(
    private readonly nats: NatsClient,
    private readonly scopes: ScopeResolutionService
  ) {}

  /**
   * Newest first: a shop is recent when the caller marked something bought
   * there in the last sixty days, and that is the only rule. `inProfile` is
   * against the caller's default profile.
   */
  @Get('recent-shops')
  @ApiComposedResponse(PURCHASE_SCHEMA_IDS.recentShopsView, {
    description:
      'The shops you marked something bought at in the last 60 days, newest first. Composed from your purchases and the catalog.',
  })
  @ApiProblemResponses({ auth: true })
  async recentShops(@AuthUser() user: CurrentUser): Promise<RecentShopsView> {
    const recent = await this.nats.send<RecentShopIdsView>(
      PURCHASE_PATTERNS.recentShops,
      { userId: user.userId }
    );
    if (recent.shops.length === 0) {
      return { shops: [] };
    }

    const selection = await this.scopes.forShops(user.userId, {});
    const req: ShopsByIdRequest = {
      supermarketLocationIds: recent.shops.map(
        (shop) => shop.supermarketLocationId
      ),
      profilePostalCodes: selection.postalCodes,
    };
    const named = await this.nats.send<ShopsByIdView>(
      SUPERMARKET_LOCATION_PATTERNS.shopsById,
      req
    );
    const byId = new Map(named.shops.map((shop) => [shop.id, shop]));

    // Core's order, newest first; a shop catalog did not name is gone.
    return {
      shops: recent.shops.flatMap((entry) => {
        const shop = byId.get(entry.supermarketLocationId);
        return shop ? [{ shop, lastBoughtAt: entry.lastBoughtAt }] : [];
      }),
    };
  }
}
