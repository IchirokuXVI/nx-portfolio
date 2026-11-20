import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PRICE_REFRESH_PATTERNS,
  PriceRefreshRefusal,
  UserKind,
  type PriceRefreshCheckView,
  type PriceRefreshIdRequest,
  type PriceRefreshRequest,
  type PriceRefreshView,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  ForbiddenException,
  NotFoundException,
  PROBLEM_JSON_CONTENT_TYPE,
  resolveErrorMessage,
  UuidParam,
} from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import {
  ApiContractResponse,
  ApiProblemResponses,
  componentRef,
} from '../docs';
import { hoistProblemDetails } from '../docs/openapi-schema';
import { NatsClient } from '../messaging/nats-client';
import {
  ACCOUNT_THROTTLE_LIMITS,
  AccountThrottle,
  AccountThrottlerGuard,
} from '../throttling/account-throttler.guard';
import { ItemRefreshBodyDto, ItemRefreshQueryDto } from './item-refresh.dto';

/**
 * The 409 a refresh answers when nothing can fetch the price, documented with
 * its reasons. `ApiProblemResponses` names the statuses every route shares;
 * this one is the harvester's, and only these two routes answer it.
 */
const ApiNotRefreshable = () =>
  applyDecorators(
    ApiResponse({
      status: HttpStatus.CONFLICT,
      description:
        `\`${ERROR_CODES.PRICE_NOT_REFRESHABLE}\` — ` +
        `${resolveErrorMessage(ERROR_CODES.PRICE_NOT_REFRESHABLE)} ` +
        '`details.reason` is one of ' +
        Object.values(PriceRefreshRefusal)
          .filter((reason) => reason !== PriceRefreshRefusal.FRESH)
          .map((reason) => `\`${reason}\``)
          .join(', ') +
        '.',
      content: {
        [PROBLEM_JSON_CONTENT_TYPE]: {
          schema: componentRef(hoistProblemDetails()),
        },
      },
    })
  );

/**
 * A registered shopper refreshes the price of one product at one price scope
 * (harvester plan 0216, section 10).
 *
 * **Registered accounts only.** A `TEMPORARY` account is refused with a 403 on
 * all three routes: a guest identity costs one request to an anonymous zone
 * route, so a per account limit means little for guests, and a guest can
 * register (the owner's answer of 2026-11-06).
 *
 * The request answers before the fetch, with the `PENDING` refresh, and the
 * client polls the third route every 2 seconds until it is not `PENDING` or
 * 30 seconds have passed (section 8). On `DONE` it reads the offer again
 * through the read it already uses.
 *
 * Its own controller, declared before `CatalogItemsController`'s `:id` reads
 * in the module, though no path of that controller can take these.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'catalog/items', version: '1' })
export class ItemRefreshController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id/refresh')
  @ApiContractResponse(PRICE_REFRESH_PATTERNS.check, {
    description:
      'Whether a refresh of this product at this scope can start, and when. `reason` is null when it can; `FRESH` with the seconds until the product window ends when the price is recent; another reason when nothing can fetch it. `pendingRefreshId` names a refresh in flight, which a request joins.',
  })
  @ApiProblemResponses({ auth: true, membership: true, body: true })
  check(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string,
    @Query() query: ItemRefreshQueryDto
  ): Promise<PriceRefreshCheckView> {
    requireRegistered(user);
    const req: PriceRefreshRequest = {
      userId: user.userId,
      itemId: id,
      priceScopeId: query.priceScopeId,
    };
    return this.nats.send<PriceRefreshCheckView>(
      PRICE_REFRESH_PATTERNS.check,
      req
    );
  }

  @Post(':id/refresh')
  @UseGuards(AccountThrottlerGuard)
  @AccountThrottle(ACCOUNT_THROTTLE_LIMITS.priceRefresh)
  @ApiContractResponse(PRICE_REFRESH_PATTERNS.request, {
    status: HttpStatus.CREATED,
    description:
      'Start a refresh, join the one in flight, or answer `FRESH` when the price is recent, in which case nothing was fetched and `id` is null. The fetch runs after the answer: poll the refresh by its id. A cooldown is a 429 with `retryAfterSeconds`.',
  })
  @ApiProblemResponses({ auth: true, membership: true, body: true })
  @ApiNotRefreshable()
  request(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string,
    @Body() body: ItemRefreshBodyDto
  ): Promise<PriceRefreshView> {
    requireRegistered(user);
    const req: PriceRefreshRequest = {
      userId: user.userId,
      itemId: id,
      priceScopeId: body.priceScopeId,
    };
    return this.nats.send<PriceRefreshView>(
      PRICE_REFRESH_PATTERNS.request,
      req
    );
  }

  @Get(':id/refreshes/:refreshId')
  @ApiContractResponse(PRICE_REFRESH_PATTERNS.get, {
    description:
      'A refresh you requested, or joined in the last two minutes. Any other id is a 404, and so is a refresh of another product than the path names.',
  })
  @ApiProblemResponses({ auth: true, membership: true })
  async get(
    @AuthUser() user: CurrentUser,
    @UuidParam('id') id: string,
    @UuidParam('refreshId') refreshId: string
  ): Promise<PriceRefreshView> {
    requireRegistered(user);
    const req: PriceRefreshIdRequest = { userId: user.userId, refreshId };
    const view = await this.nats.send<PriceRefreshView>(
      PRICE_REFRESH_PATTERNS.get,
      req
    );
    if (view.itemId !== id) {
      throw new NotFoundException('Price refresh not found');
    }
    return view;
  }
}

function requireRegistered(user: CurrentUser): void {
  if (user.kind !== UserKind.REGISTERED) {
    throw new ForbiddenException(
      'Register an account to refresh a price. A guest cannot.'
    );
  }
}
