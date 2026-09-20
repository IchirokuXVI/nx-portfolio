import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BASKET_PATTERNS,
  BASKET_SCHEMA_IDS,
  ITEM_PATTERNS,
  type AddBasketLineRequest,
  type BasketResult,
  type BasketRowResult,
  type BasketSearchScope,
  type BasketSummaryView,
  type BasketView,
  type CatalogSuggestResponse,
  type GeneratedListParticipantContext,
  type GetBasketRequest,
  type GetLiveBasketRequest,
  type ItemPage,
  type ProductGroupOfferPage,
  type RenameBasketRowRequest,
  type RevertBasketRowRequest,
  type SetBasketRowDemandRequest,
  type SettleBasketRowRequest,
  type SkipBasketRowRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { SUGGEST_SCHEMA } from '../catalog/catalog.controller';
import {
  ApiComposedResponse,
  ApiContractResponse,
  ApiProblemResponses,
  componentRef,
} from '../docs';
import { BasketSuggestQueryDto } from '../generated-lists/generated-list-sharing.dto';
import {
  PARTICIPANT_THROTTLE_LIMITS,
  ParticipantThrottle,
  ParticipantThrottlerGuard,
} from '../generated-lists/participant-throttler.guard';
import {
  Participant,
  ParticipantGuard,
} from '../generated-lists/participant.guard';
import { NatsClient } from '../messaging/nats-client';
import { BasketCatalogService } from './basket-catalog.service';
import {
  AddBasketLineDto,
  RenameBasketRowDto,
  RevertBasketRowDto,
  SetBasketRowDemandDto,
  SettleBasketRowDto,
} from './basket.dto';

/**
 * The basket that is always there (plan 0136, section 4).
 *
 * Account only, and its own controller because of the guard: everything else
 * under `/v1/baskets` is the participant surface, where a guest arrives with a
 * session secret and no account.
 *
 * **It is registered before {@link BasketController}**, and the order is a
 * routing rule rather than a preference: `live` and `:id` both match
 * `GET /v1/baskets/live`, Nest registers routes in controller order and the
 * first match runs, so the literal path has to come first or the participant
 * guard would answer a route that has no participant.
 */
@ApiTags('baskets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'baskets', version: '1' })
export class BasketLiveController {
  constructor(
    private readonly nats: NatsClient,
    private readonly catalog: BasketCatalogService
  ) {}

  /**
   * The caller's permanent basket, created the first time they ask for it.
   *
   * Idempotent the way a create is: two tabs opening the app at once make one
   * basket, through the partial unique index rather than through a lock.
   */
  @Get('live')
  @ApiComposedResponse(BASKET_SCHEMA_IDS.result)
  @ApiProblemResponses({ auth: true })
  async live(@AuthUser() user: CurrentUser): Promise<BasketResult> {
    const req: GetLiveBasketRequest = { userId: user.userId };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.live, req);
    return this.compose(basket);
  }

  /**
   * The three numbers the home card draws, with no rows behind them.
   *
   * Its own route because the card must not pay for a thousand rows and a
   * catalog composition to show three numbers.
   */
  @Get('live/summary')
  @ApiContractResponse(BASKET_PATTERNS.liveSummary)
  @ApiProblemResponses({ auth: true })
  summary(@AuthUser() user: CurrentUser): Promise<BasketSummaryView> {
    const req: GetLiveBasketRequest = { userId: user.userId };
    return this.nats.send<BasketSummaryView>(
      BASKET_PATTERNS.liveSummary,
      req
    );
  }

  /**
   * The catalog half, composed as the participant surface composes it.
   *
   * The owner reads their own permanent basket as their own participant row, so
   * the answer is the same shape the shared screen gets and there is one basket
   * screen rather than two.
   */
  private async compose(basket: BasketView): Promise<BasketResult> {
    const resolved = await this.catalog.resolvedScopesOf(
      basket.id,
      basket.me.id
    );
    const products = await this.catalog.productsOf(
      basket,
      resolved?.view.priceScopeIds
    );
    const scopes = resolved
      ? await this.catalog.scopesOf(
          products,
          resolved.ownerUserId,
          resolved.view,
          basket.servesLocations
        )
      : [];
    return { ...basket, products, scopes };
  }
}

/**
 * The basket, and the seven writes on a row (plan 0136; plan 0137).
 *
 * Every route is behind {@link ParticipantGuard}: the gateway turns a credential
 * into a participant and the participant is the whole of the identity here. An
 * owner reading their own basket arrives as their own participant row like
 * everybody else, which is what lets one screen serve all three readers.
 *
 * ## A row is addressed by a line id
 *
 * `rowKey` is the anchor's list line id, and any entry's id names the same row.
 * A row has no identity of its own because it is recomputed on every read, and a
 * row whose anchor was bought to zero a moment ago must not turn the next tap
 * into a not found.
 */
@ApiTags('baskets')
@UseGuards(ParticipantGuard)
@Controller({ path: 'baskets', version: '1' })
export class BasketController {
  constructor(
    private readonly nats: NatsClient,
    private readonly catalog: BasketCatalogService
  ) {}

  /** The basket, its rows, its people and the products they name. */
  @Get(':id')
  @ApiComposedResponse(BASKET_SCHEMA_IDS.result)
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
  async get(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string
  ): Promise<BasketResult> {
    const req: GetBasketRequest = {
      basketId: id,
      participantId: participant.participantId,
    };
    const basket = await this.nats.send<BasketView>(BASKET_PATTERNS.get, req);

    const resolved = await this.catalog.resolvedScopesOf(
      id,
      participant.participantId
    );
    const products = await this.catalog.productsOf(
      basket,
      resolved?.view.priceScopeIds
    );
    const scopes = resolved
      ? await this.catalog.scopesOf(
          products,
          resolved.ownerUserId,
          resolved.view,
          basket.servesLocations
        )
      : [];
    return { ...basket, products, scopes };
  }

  /** Say what happened to a row at the shelf. */
  @Post(':id/rows/:rowKey/settle')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  // 201, which is what Nest answers for a `POST` and what the settle this
  // replaced already documented: a write on a row appends a settlement row
  // rather than replacing one.
  @ApiContractResponse(BASKET_PATTERNS.rowSettle, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
    finishedBasket: true,
  })
  settle(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: SettleBasketRowDto
  ): Promise<BasketRowResult> {
    const req: SettleBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      outcome: dto.outcome,
      quantity: dto.quantity,
      from: dto.from,
      itemId: dto.itemId,
      allocations: dto.allocations,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowSettle, req);
  }

  /** Take back units somebody said they bought, or the close on a row. */
  @Post(':id/rows/:rowKey/revert')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  // 201, which is what Nest answers for a `POST` and what the settle this
  // replaced already documented: a write on a row appends a settlement row
  // rather than replacing one.
  @ApiContractResponse(BASKET_PATTERNS.rowRevert, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    notFound: true,
    finishedBasket: true,
  })
  revert(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: RevertBasketRowDto
  ): Promise<BasketRowResult> {
    const req: RevertBasketRowRequest =
      dto.target === 'UNITS'
        ? {
            basketId: id,
            participantId: participant.participantId,
            rowKey,
            target: 'UNITS',
            // The DTO cannot require them on one branch alone without a `oneOf`
            // that renders badly in the published document, so the two fields
            // are optional there and required here, where the branch is known.
            units: requireField(dto.units, 'units'),
            from: requireField(dto.from, 'from'),
          }
        : {
            basketId: id,
            participantId: participant.participantId,
            rowKey,
            target: 'CLOSE',
          };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowRevert, req);
  }

  /** Change what one household asks for, from the basket. */
  @Post(':id/rows/:rowKey/demand')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  // 201, which is what Nest answers for a `POST` and what the settle this
  // replaced already documented: a write on a row appends a settlement row
  // rather than replacing one.
  @ApiContractResponse(BASKET_PATTERNS.rowDemand, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    notFound: true,
    finishedBasket: true,
  })
  demand(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: SetBasketRowDemandDto
  ): Promise<BasketRowResult> {
    const req: SetBasketRowDemandRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
      lineId: dto.lineId,
      quantity: dto.quantity,
      from: dto.from,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowDemand, req);
  }

  /** Rename a row, and every list line it is made of (plan 0113's rule). */
  @Patch(':id/rows/:rowKey')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowRename)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    finishedBasket: true,
    lineMerge: true,
  })
  rename(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('rowKey') rowKey: string,
    @Body() dto: RenameBasketRowDto
  ): Promise<BasketRowResult> {
    const req: RenameBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId: requireAccount(participant),
      rowKey,
      content: dto.content,
      confirmMerge: dto.confirmMerge,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowRename, req);
  }

  /**
   * Put a row off for now (plan 0137, section 5.1).
   *
   * A `PUT` rather than a `POST`, because it states a condition the row is to be
   * in rather than appending an act: a second call changes nothing and answers
   * the same row. Any live participant may send it, a guest included, and
   * neither this nor the `DELETE` takes a body.
   */
  @Put(':id/rows/:rowKey/skip')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowSkip)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    // A row bought to zero while the sheet was open has nothing left to skip,
    // which is a plain conflict beside the finished basket's own code.
    conflict: true,
    finishedBasket: true,
  })
  skip(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('rowKey') rowKey: string
  ): Promise<BasketRowResult> {
    const req: SkipBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowSkip, req);
  }

  /** Take the skip back (plan 0137, section 5.2). Finding none is not an error. */
  @Delete(':id/rows/:rowKey/skip')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.rowUnskip)
  @ApiProblemResponses({
    auth: true,
    participant: true,
    notFound: true,
    finishedBasket: true,
  })
  unskip(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Param('rowKey') rowKey: string
  ): Promise<BasketRowResult> {
    const req: SkipBasketRowRequest = {
      basketId: id,
      participantId: participant.participantId,
      rowKey,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.rowUnskip, req);
  }

  /**
   * Put a line on one of the basket's lists.
   *
   * **Account participants only**, which reverses plan 0055's guest composer:
   * a basket holds no lines of its own any more, so there is nowhere for a line
   * with no list to live and every add is a write to a household.
   */
  @Post(':id/lines')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.write)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiContractResponse(BASKET_PATTERNS.lineAdd, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({
    auth: true,
    participant: true,
    body: true,
    membership: true,
    notFound: true,
    finishedBasket: true,
  })
  addLine(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Body() dto: AddBasketLineDto
  ): Promise<BasketRowResult> {
    const req: AddBasketLineRequest = {
      basketId: id,
      participantId: participant.participantId,
      userId: requireAccount(participant),
      targetListId: dto.targetListId,
      content: dto.content,
      quantity: dto.quantity,
      itemIds: dto.itemIds,
    };
    return this.nats.send<BasketRowResult>(BASKET_PATTERNS.lineAdd, req);
  }

  /** The composer's dropdown, priced at the basket's own scopes. */
  @Get(':id/catalog/suggest')
  @ParticipantThrottle(PARTICIPANT_THROTTLE_LIMITS.suggest)
  @UseGuards(ParticipantThrottlerGuard)
  @ApiOkResponse({
    description:
      'The dropdown, in the order it is to be drawn: every matching group first, then the individual products. The same body /v1/catalog/suggest answers, field for field.',
    schema: componentRef(SUGGEST_SCHEMA),
  })
  @ApiProblemResponses({ auth: true, participant: true, notFound: true })
  async suggest(
    @Participant() participant: GeneratedListParticipantContext,
    @Param('id') id: string,
    @Query() query: BasketSuggestQueryDto
  ): Promise<CatalogSuggestResponse> {
    const scope = await this.nats.send<BasketSearchScope>(
      BASKET_PATTERNS.searchScope,
      { basketId: id, participantId: participant.participantId }
    );

    const common = {
      userId: scope.ownerUserId,
      query: query.q,
      priceScopeIds: (await this.catalog.describeScopes(scope))?.priceScopeIds,
      limit: query.limit,
    };
    const [groups, items] = await Promise.all([
      this.nats
        .send<ProductGroupOfferPage>(ITEM_PATTERNS.searchOffers, common)
        .catch(
          () => ({ items: [], nextCursor: null }) as ProductGroupOfferPage
        ),
      this.nats
        .send<ItemPage>(ITEM_PATTERNS.search, common)
        .catch(() => ({ items: [], nextCursor: null }) as ItemPage),
    ]);

    return {
      suggestions: [
        ...groups.items.map((group) => ({
          kind: 'group' as const,
          group,
          item: null,
        })),
        ...items.items.map((item) => ({
          kind: 'item' as const,
          group: null,
          item,
        })),
      ],
    };
  }
}

/**
 * The actor's account, for the two routes that are not delegated writes.
 *
 * Adding a line and renaming a row are authorized by the **person making
 * them**, so a guest is refused here rather than in core: they present a
 * session secret and hold no `WRITE` on anything.
 */
function requireAccount(
  participant: GeneratedListParticipantContext
): string {
  if (!participant.userId) {
    throw new ForbiddenException(
      'Only people with an account can do this on a basket'
    );
  }
  return participant.userId;
}

/**
 * A field the DTO could not require on its own branch.
 *
 * `RevertBasketRowDto` would need a `oneOf` to say that `units` and `from`
 * belong to `UNITS` alone, and a `oneOf` renders badly in the published document
 * where a client author reads one request body. So the two are optional there
 * and required here, where the branch is known.
 */
function requireField<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new ValidationException(`${field} is required for this target`, {
      messageArgs: { field },
    });
  }
  return value;
}
