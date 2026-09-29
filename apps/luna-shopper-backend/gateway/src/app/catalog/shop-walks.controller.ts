import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  SHOP_WALK_PATTERNS,
  type AppendShopWalkEntryRequest,
  type AppendShopWalkEntryResult,
  type CreateShopWalkRequest,
  type ListShopWalksRequest,
  type LocationShopMapRequest,
  type LocationShopMapView,
  type ShopWalkIdRequest,
  type ShopWalkListView,
  type ShopWalkLogRequest,
  type ShopWalkLogView,
  type ShopWalkSummaryView,
  type ShopWalkView,
  type UpdateShopWalkRequest,
} from '@portfolio/luna-shopper/contracts';
import { UuidParam } from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import type { CurrentUser } from '../auth/jwt.strategy';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  ACCOUNT_THROTTLE_LIMITS,
  AccountThrottle,
  AccountThrottlerGuard,
} from '../throttling/account-throttler.guard';
import {
  AppendShopWalkEntryDto,
  CreateShopWalkDto,
  ShopWalkLogQueryDto,
  UpdateShopWalkDto,
} from './shop-walks.dto';

/** The one permission every walk route requires (plan 0175). */
const RECORD = 'shopMap.record';

/**
 * The map of a shop, as a shopper sees it (backend plan 0168, section 3).
 *
 * **Public: no guard and no token**, and its own controller for that reason,
 * like `CatalogLocationSectionsController` beside it: a guard is carried by the
 * controller, and a guest reading a shared basket at a shop has no account.
 * It answers the **shown** walk only, projected through `shopperView`, as of its
 * last save. The walks themselves are behind the permission below.
 */
@ApiTags('catalog')
@Controller({ path: 'catalog/locations', version: '1' })
export class CatalogLocationMapController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id/map')
  @ApiContractResponse(SHOP_WALK_PATTERNS.mapForLocation, {
    description:
      'The walk shown to shoppers, drawn for a shopper: the walkway, the areas, the notes and the bounds, plus the chain sections its section names resolved to in walk order. `map` is null when the shop has no shown walk. An unknown shop is a 404.',
  })
  @ApiProblemResponses({ notFound: true })
  map(@UuidParam('id') id: string): Promise<LocationShopMapView> {
    const req: LocationShopMapRequest = { supermarketLocationId: id };
    return this.nats.send<LocationShopMapView>(
      SHOP_WALK_PATTERNS.mapForLocation,
      req
    );
  }
}

/**
 * A shop's walks (plan 0168, section 3), for an account with `shopMap.record`.
 * Declared on the locations path beside its public siblings; the routes do not
 * collide (`:id/walks` here).
 */
@ApiTags('catalog')
@Controller({ path: 'catalog/locations', version: '1' })
export class CatalogLocationWalksController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id/walks')
  @RequirePermission(RECORD)
  @ApiContractResponse(SHOP_WALK_PATTERNS.list, {
    description:
      'The shop’s walks that are not deleted: the shown one first, then the rest by last change, newest first.',
  })
  @ApiProblemResponses({ auth: true, permission: true, notFound: true })
  list(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string
  ): Promise<ShopWalkListView> {
    const req: ListShopWalksRequest = {
      userId: user.userId,
      supermarketLocationId: id,
    };
    return this.nats.send<ShopWalkListView>(SHOP_WALK_PATTERNS.list, req);
  }

  @Post(':id/walks')
  @RequirePermission(RECORD)
  @ApiContractResponse(SHOP_WALK_PATTERNS.create, {
    status: HttpStatus.CREATED,
    description: 'A new empty walk, not shown to shoppers.',
  })
  @ApiProblemResponses({
    auth: true,
    permission: true,
    body: true,
    notFound: true,
  })
  create(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string,
    @Body() body: CreateShopWalkDto
  ): Promise<ShopWalkSummaryView> {
    const req: CreateShopWalkRequest = {
      userId: user.userId,
      supermarketLocationId: id,
      name: body.name,
    };
    return this.nats.send<ShopWalkSummaryView>(SHOP_WALK_PATTERNS.create, req);
  }
}

/**
 * One walk at its own id (plan 0168, sections 2 and 3), for an account with
 * `shopMap.record`. The log only grows: no route here edits or deletes an
 * entry, and deleting a walk keeps its entries.
 */
@ApiTags('catalog')
@Controller({ path: 'catalog/walks', version: '1' })
export class CatalogWalksController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':walkId')
  @RequirePermission(RECORD)
  @ApiContractResponse(SHOP_WALK_PATTERNS.get, {
    description:
      'The walk, its folded document, and its timeline: one row per entry, without events, in `seq` order.',
  })
  @ApiProblemResponses({ auth: true, permission: true, notFound: true })
  get(
    @AuthUser() user: CurrentUser,
    @UuidParam('walkId') walkId: string
  ): Promise<ShopWalkView> {
    const req: ShopWalkIdRequest = { userId: user.userId, walkId };
    return this.nats.send<ShopWalkView>(SHOP_WALK_PATTERNS.get, req);
  }

  @Get(':walkId/log')
  @RequirePermission(RECORD)
  @ApiContractResponse(SHOP_WALK_PATTERNS.log, {
    description:
      'The entries with their events after the latest snapshot at or before `fromSeq`, with that snapshot, for a rewind preview folded on the phone.',
  })
  @ApiProblemResponses({
    auth: true,
    permission: true,
    body: true,
    notFound: true,
  })
  log(
    @AuthUser() user: CurrentUser,
    @UuidParam('walkId') walkId: string,
    @Query() query: ShopWalkLogQueryDto
  ): Promise<ShopWalkLogView> {
    const req: ShopWalkLogRequest = {
      userId: user.userId,
      walkId,
      ...(query.fromSeq !== undefined ? { fromSeq: query.fromSeq } : {}),
    };
    return this.nats.send<ShopWalkLogView>(SHOP_WALK_PATTERNS.log, req);
  }

  @Patch(':walkId')
  @RequirePermission(RECORD)
  @ApiContractResponse(SHOP_WALK_PATTERNS.update, {
    description:
      'Rename the walk, show it or stop showing it. Showing it stops showing the shop’s other walk and rewrites the shop’s section list in this walk’s order.',
  })
  @ApiProblemResponses({
    auth: true,
    permission: true,
    body: true,
    notFound: true,
  })
  update(
    @AuthUser() user: CurrentUser,
    @UuidParam('walkId') walkId: string,
    @Body() body: UpdateShopWalkDto
  ): Promise<ShopWalkSummaryView> {
    const req: UpdateShopWalkRequest = {
      userId: user.userId,
      walkId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.shown !== undefined ? { shown: body.shown } : {}),
    };
    return this.nats.send<ShopWalkSummaryView>(SHOP_WALK_PATTERNS.update, req);
  }

  @Delete(':walkId')
  @RequirePermission(RECORD)
  @ApiContractResponse(SHOP_WALK_PATTERNS.delete, {
    description:
      'Sets `deletedAt` and keeps every entry. A shown walk stops being shown, and the shop has no map.',
  })
  @ApiProblemResponses({ auth: true, permission: true, notFound: true })
  delete(
    @AuthUser() user: CurrentUser,
    @UuidParam('walkId') walkId: string
  ): Promise<{ id: string }> {
    const req: ShopWalkIdRequest = { userId: user.userId, walkId };
    return this.nats.send<{ id: string }>(SHOP_WALK_PATTERNS.delete, req);
  }

  /**
   * Section 2. Idempotent on the entry's id, so a save retried after a lost
   * answer answers what the first one stored. Throttled per account.
   */
  @Post(':walkId/entries')
  @UseGuards(AccountThrottlerGuard)
  @RequirePermission(RECORD)
  @AccountThrottle(ACCOUNT_THROTTLE_LIMITS.shopWalkEntries)
  @ApiContractResponse(SHOP_WALK_PATTERNS.append, {
    status: HttpStatus.CREATED,
    description:
      'The entry as stored and the walk after it. A retried id answers the first result with `replayed: true`. A `baseSeq` that is not the walk’s `lastSeq` is `walk_changed` with `details.lastSeq`; a fold that does not validate is `shop_map_invalid` with `details.problems`; an entry over 256 KB or a document over 2 MB is `shop_map_too_large`.',
  })
  @ApiProblemResponses({
    auth: true,
    permission: true,
    body: true,
    notFound: true,
    shopWalk: true,
  })
  append(
    @AuthUser() user: CurrentUser,
    @UuidParam('walkId') walkId: string,
    @Body() body: AppendShopWalkEntryDto
  ): Promise<AppendShopWalkEntryResult> {
    const req: AppendShopWalkEntryRequest = {
      userId: user.userId,
      walkId,
      id: body.id,
      baseSeq: body.baseSeq,
      kind: body.kind,
      at: body.at,
      logFrom: body.logFrom,
      logTo: body.logTo,
      events: body.events,
      ...(body.rewoundTo !== undefined ? { rewoundTo: body.rewoundTo } : {}),
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    };
    return this.nats.send<AppendShopWalkEntryResult>(
      SHOP_WALK_PATTERNS.append,
      req
    );
  }
}
